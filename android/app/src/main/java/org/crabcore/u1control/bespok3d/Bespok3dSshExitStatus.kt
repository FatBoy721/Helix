package org.crabcore.u1control.bespok3d

import com.jcraft.jsch.ChannelExec
import java.net.SocketTimeoutException
import java.util.concurrent.TimeUnit

/**
 * JSch may deliver command EOF before the SSH exit-status packet. Reading
 * Channel.exitStatus immediately can therefore return -1 for a successful
 * command. Wait for the packet with the same finite bound as the channel.
 */
internal fun ChannelExec.awaitExitStatus(timeoutMs: Int): Int = awaitSshExitStatus(
  readStatus = { exitStatus },
  timeoutMs = timeoutMs.toLong(),
)

internal fun awaitSshExitStatus(
  readStatus: () -> Int,
  timeoutMs: Long,
  nanoTime: () -> Long = System::nanoTime,
  pause: (Long) -> Unit = Thread::sleep,
): Int {
  require(timeoutMs > 0) { "SSH exit-status timeout must be positive" }
  val startedAt = nanoTime()
  val timeoutNanos = TimeUnit.MILLISECONDS.toNanos(timeoutMs)
  while (true) {
    val status = readStatus()
    if (status >= 0) return status
    val elapsed = nanoTime() - startedAt
    if (elapsed >= timeoutNanos) {
      throw SocketTimeoutException("Timed out waiting for SSH command exit status")
    }
    val remainingMs = TimeUnit.NANOSECONDS.toMillis(timeoutNanos - elapsed)
    pause(remainingMs.coerceIn(1, EXIT_STATUS_POLL_MS))
  }
}

private const val EXIT_STATUS_POLL_MS = 10L
