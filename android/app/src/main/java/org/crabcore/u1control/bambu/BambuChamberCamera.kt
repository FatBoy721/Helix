// Bambu's chamber camera, republished as MJPEG on loopback.
//
// The P-series does not serve RTSP (that is X1-only, on 322) or anything a
// WebView can open. Port 6000 speaks a private protocol, verified against a
// P1S:
//
//   client -> 80-byte auth packet: <I 0x40><I 0x3000><I 0><I 0>
//             then username and access code, each NUL-padded to 32 bytes
//   server -> repeating: 16-byte header whose first LE uint32 is the payload
//             length, followed by that many bytes of a complete JPEG
//
// Rather than push ~90KB frames across the React Native bridge, this serves
// them as multipart/x-mixed-replace on 127.0.0.1. components/CameraFeed.tsx
// already drives an MJPEG player for Moonraker webcams, so it can point at the
// local URL and needs no Bambu-specific code.
//
// No React Native imports here, so it can be tested against a real printer from
// a plain JVM — see BambuLiveCameraTest.
// crabcore

package org.crabcore.u1control.bambu

import android.util.Log
import java.io.BufferedInputStream
import java.io.DataInputStream
import java.io.IOException
import java.io.OutputStream
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.ServerSocket
import java.net.Socket
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.nio.charset.StandardCharsets
import java.security.SecureRandom
import java.security.cert.CertificateException
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import javax.net.ssl.SSLSocket

/**
 * @param onStopped fired when the printer's video stream ends for any reason.
 *   Without it a dropped stream leaves the UI showing a URL that will never
 *   serve another frame, and nothing to trigger a retry.
 */
class BambuChamberCamera(private val onStopped: (() -> Unit)? = null) {

  private val frameLock = Object()
  private var latestFrame: ByteArray? = null
  private var frameSequence = 0L

  @Volatile private var running = false
  @Volatile private var failure: String? = null
  private var server: ServerSocket? = null
  private val threads = mutableListOf<Thread>()

  /**
   * Connects to the printer and starts serving. Blocks until the first frame
   * arrives so the caller gets either a working URL or a real error, rather
   * than a URL that quietly never produces an image.
   */
  @Synchronized
  fun start(host: String, serial: String, accessCode: String): String {
    stop()

    // Loopback only: the stream is for this app, not for the network. The token
    // keeps other apps on the device from guessing the URL.
    val socket = ServerSocket(0, 2, InetAddress.getByName(LOOPBACK))
    server = socket
    running = true
    failure = null

    val token = randomToken()
    val firstFrame = CountDownLatch(1)

    Log.i(TAG, "starting camera for $host on local port ${socket.localPort}")
    spawn("helix-bambu-cam-reader") { readFrames(host, serial, accessCode, firstFrame) }
    spawn("helix-bambu-cam-server") { acceptClients(socket, token) }

    // The reader releases this latch when it gives up as well as when a frame
    // lands, so waiting on it alone would treat a refused handshake as success
    // and hand back a URL that never produces an image. The frame itself is the
    // only proof that matters.
    val settled = firstFrame.await(FIRST_FRAME_TIMEOUT_SECONDS, TimeUnit.SECONDS)
    val gotFrame = synchronized(frameLock) { latestFrame != null }

    if (!gotFrame) {
      val reason = failure
        ?: if (settled) "The printer closed the video stream without sending a frame"
        else "The printer sent no video within ${FIRST_FRAME_TIMEOUT_SECONDS}s"
      Log.w(TAG, "camera failed to start: $reason")
      stop()
      throw BambuConnectException(cameraErrorCode(reason), reason)
    }

    return "http://$LOOPBACK:${socket.localPort}/stream/$token"
  }

  @Synchronized
  fun stop() {
    running = false
    try {
      server?.close()
    } catch (_: IOException) {
      // Already closed.
    }
    server = null
    threads.forEach(Thread::interrupt)
    threads.clear()
    synchronized(frameLock) {
      latestFrame = null
      frameLock.notifyAll()
    }
  }

  /** True while frames are still arriving from the printer. */
  fun isRunning(): Boolean = running

  private fun spawn(name: String, body: () -> Unit) {
    val thread = Thread(body, name)
    thread.isDaemon = true
    threads.add(thread)
    thread.start()
  }

  private fun readFrames(
    host: String,
    serial: String,
    accessCode: String,
    firstFrame: CountDownLatch
  ) {
    var socket: SSLSocket? = null
    try {
      socket = (bambuSocketFactory(serial).createSocket() as SSLSocket).apply {
        connect(InetSocketAddress(host, CAMERA_PORT), CONNECT_TIMEOUT_MS)
        soTimeout = READ_TIMEOUT_MS
        startHandshake()
      }

      socket.outputStream.apply {
        write(authPacket(accessCode))
        flush()
      }

      val input = DataInputStream(BufferedInputStream(socket.inputStream))
      val header = ByteArray(HEADER_BYTES)

      while (running) {
        input.readFully(header)
        val size = ByteBuffer.wrap(header, 0, 4).order(ByteOrder.LITTLE_ENDIAN).int
        // A bad access code shows up here as garbage rather than a refusal, so
        // an implausible length is the tell.
        if (size <= 0 || size > MAX_FRAME_BYTES) {
          throw IOException("Frame length $size is out of range; check the access code")
        }

        val frame = ByteArray(size)
        input.readFully(frame)
        publish(frame)
        firstFrame.countDown()
      }
    } catch (e: Exception) {
      if (running) {
        failure = describeFailure(e)
        Log.w(TAG, "camera reader stopped: $failure")
      }
    } finally {
      running = false
      firstFrame.countDown()
      try {
        socket?.close()
      } catch (_: IOException) {
        // Nothing left to do.
      }
      // Unblock the acceptor so it can release the port, and wake any viewer
      // waiting on a frame that is never coming.
      try {
        server?.close()
      } catch (_: IOException) {
        // Already closed.
      }
      synchronized(frameLock) { frameLock.notifyAll() }
      onStopped?.invoke()
    }
  }

  private fun publish(frame: ByteArray) {
    synchronized(frameLock) {
      latestFrame = frame
      frameSequence += 1
      frameLock.notifyAll()
    }
  }

  private fun acceptClients(socket: ServerSocket, token: String) {
    try {
      while (running) {
        val client = try {
          socket.accept()
        } catch (_: IOException) {
          return
        }
        Log.i(TAG, "camera viewer connected")
        spawn("helix-bambu-cam-client") { serveClient(client, token) }
      }
    } finally {
      // Leaving this open once the loop ends would strand a bound port with
      // nobody accepting: viewers would connect at the TCP level and then hang
      // forever waiting for a reply that no thread is left to send.
      try {
        socket.close()
      } catch (_: IOException) {
        // Already closed.
      }
      Log.i(TAG, "camera server closed")
    }
  }

  private fun serveClient(client: Socket, token: String) {
    try {
      client.use { connection ->
        val request = DataInputStream(BufferedInputStream(connection.inputStream))
          .readLine()
          .orEmpty()

        Log.i(TAG, "camera request: $request")
        when {
          request.contains("/stream/$token") -> {
            val out = connection.outputStream
            out.write(
              (
                "HTTP/1.0 200 OK\r\n" +
                  "Cache-Control: no-store\r\n" +
                  "Connection: close\r\n" +
                  "Content-Type: multipart/x-mixed-replace; boundary=$BOUNDARY\r\n\r\n"
                ).toByteArray()
            )
            out.flush()
            streamTo(out)
          }
          // The newest frame is already in memory, so a still costs no printer
          // connection — the app polls this instead of decoding the MJPEG stream
          // in a WebView.
          request.contains("/frame/$token") -> {
            val frame = synchronized(frameLock) { latestFrame }
            val out = connection.outputStream
            if (frame == null) {
              out.write("HTTP/1.0 503 Service Unavailable\r\nContent-Length: 0\r\n\r\n".toByteArray())
            } else {
              out.write(
                (
                  "HTTP/1.0 200 OK\r\n" +
                    "Cache-Control: no-store\r\n" +
                    "Connection: close\r\n" +
                    "Content-Type: image/jpeg\r\n" +
                    "Content-Length: ${frame.size}\r\n\r\n"
                  ).toByteArray()
              )
              out.write(frame)
            }
            out.flush()
          }
          else -> {
            connection.outputStream.write(
              "HTTP/1.0 404 Not Found\r\nContent-Length: 0\r\n\r\n".toByteArray()
            )
          }
        }
      }
    } catch (_: IOException) {
      // The viewer went away; nothing to report.
    }
  }

  private fun streamTo(out: OutputStream) {
    var sent = 0L

    while (running) {
      val frame: ByteArray
      synchronized(frameLock) {
        while (running && frameSequence == sent) {
          try {
            frameLock.wait(FRAME_WAIT_MS)
          } catch (_: InterruptedException) {
            // stop() interrupts every camera worker to make printer switches
            // immediate. That is normal cooperative shutdown, not a fatal
            // thread failure Android should surface as an app crash.
            Thread.currentThread().interrupt()
            return
          }
        }
        if (!running) return
        frame = latestFrame ?: return
        sent = frameSequence
      }

      out.write(
        (
          "--$BOUNDARY\r\nContent-Type: image/jpeg\r\nContent-Length: ${frame.size}\r\n\r\n"
          ).toByteArray()
      )
      out.write(frame)
      out.write("\r\n".toByteArray())
      out.flush()
    }
  }

  /**
   * A rejected certificate surfaces as an SSLHandshakeException whose own
   * message says nothing useful — our trust manager's explanation is buried
   * further down the chain, and it is the only part worth showing anyone.
   */
  private fun describeFailure(error: Throwable): String {
    var cursor: Throwable? = error
    while (cursor != null) {
      val message = cursor.message
      if (cursor is CertificateException && !message.isNullOrBlank()) return message
      cursor = cursor.cause
    }
    return error.message ?: error.javaClass.simpleName
  }

  private fun cameraErrorCode(reason: String): String = when {
    reason.contains(BAMBU_SERIAL_MISMATCH) -> "wrong-serial"
    reason.contains("access code") -> "wrong-access-code"
    else -> "camera-failed"
  }

  private fun authPacket(accessCode: String): ByteArray =
    ByteBuffer.allocate(AUTH_PACKET_BYTES).order(ByteOrder.LITTLE_ENDIAN).apply {
      putInt(AUTH_MAGIC_SIZE)
      putInt(AUTH_MAGIC_TYPE)
      putInt(0)
      putInt(0)
      put(padded(LAN_USERNAME))
      put(padded(accessCode))
    }.array()

  /** Fixed-width NUL-padded field, as the printer's parser expects. */
  private fun padded(value: String): ByteArray = ByteArray(FIELD_BYTES).also { field ->
    val bytes = value.toByteArray(StandardCharsets.US_ASCII)
    System.arraycopy(bytes, 0, field, 0, minOf(bytes.size, FIELD_BYTES))
  }

  private fun randomToken(): String {
    val bytes = ByteArray(9)
    SecureRandom().nextBytes(bytes)
    return bytes.joinToString("") { "%02x".format(it) }
  }

  companion object {
    const val CAMERA_PORT = 6000
    private const val TAG = "HelixBambuCam"
    private const val LOOPBACK = "127.0.0.1"
    private const val LAN_USERNAME = "bblp"
    private const val BOUNDARY = "helixframe"
    private const val HEADER_BYTES = 16
    private const val FIELD_BYTES = 32
    private const val AUTH_PACKET_BYTES = 80
    private const val AUTH_MAGIC_SIZE = 0x40
    private const val AUTH_MAGIC_TYPE = 0x3000
    /** Observed frames are 80-100KB; this only needs to catch nonsense. */
    private const val MAX_FRAME_BYTES = 8 * 1024 * 1024
    private const val CONNECT_TIMEOUT_MS = 8000
    /** The P1S sends a frame roughly every second, so this is generous. */
    private const val READ_TIMEOUT_MS = 15000
    private const val FIRST_FRAME_TIMEOUT_SECONDS = 15L
    private const val FRAME_WAIT_MS = 1000L
  }
}
