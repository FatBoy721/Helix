package org.crabcore.u1control.slicing

import java.io.File
import java.io.InputStream
import java.io.OutputStreamWriter
import java.io.Writer
import java.util.zip.ZipEntry
import java.util.zip.ZipFile
import java.util.zip.ZipOutputStream
import org.xmlpull.v1.XmlPullParser
import org.xmlpull.v1.XmlPullParserFactory

/**
 * Reads and splits Bambu/OrcaSlicer multi-plate 3MFs.
 *
 * The native engine has no plate concept — loadModel() drops every object from
 * every plate onto one bed (they're laid out across world-X in the source file,
 * so they land off the 270mm bed / overlapping). To print a single plate we
 * repack a temp 3MF whose <build> keeps only that plate's objects, then let the
 * prepare screen auto-arrange them back onto the bed.
 *
 * Plate → object mapping lives in Metadata/model_settings.config:
 *   <plate>
 *     <metadata key="plater_id" value="2"/>
 *     <metadata key="plater_name" value="Body"/>
 *     <metadata key="thumbnail_file" value="Metadata/plate_2.png"/>
 *     <model_instance><metadata key="object_id" value="14"/>...</model_instance>
 *   </plate>
 * and the geometry/placement in 3D/3dmodel.model's <build><item objectid=.../>.
 */
object PlateExtractor {

  data class Plate(
    val id: Int,
    val name: String,
    val objectIds: List<Int>,
    val thumbnailEntry: String?,
  )

  private val PLATE_BLOCK =
    Regex("<plate\\b[^>]*>(.*?)</plate>", setOf(RegexOption.DOT_MATCHES_ALL, RegexOption.IGNORE_CASE))
  private val META =
    Regex("<metadata\\s+key=\"([^\"]+)\"\\s+value=\"([^\"]*)\"", RegexOption.IGNORE_CASE)
  private val OBJECT_ID =
    Regex("<metadata\\s+key=\"object_id\"\\s+value=\"(\\d+)\"", RegexOption.IGNORE_CASE)

  private val BUILD_BLOCK =
    Regex("(<build\\b[^>]*>)(.*?)(</build>)", setOf(RegexOption.DOT_MATCHES_ALL, RegexOption.IGNORE_CASE))
  private val ITEM =
    Regex("<item\\b[^>]*?/>|<item\\b[^>]*?>.*?</item>", setOf(RegexOption.DOT_MATCHES_ALL, RegexOption.IGNORE_CASE))
  private val ITEM_OBJECT_ID = Regex("objectid=\"(\\d+)\"", RegexOption.IGNORE_CASE)
  private val OBJECT_BLOCK =
    Regex("<object\\b[^>]*\\bid=\"(\\d+)\"[^>]*(?:/>|>.*?</object>)", setOf(RegexOption.DOT_MATCHES_ALL, RegexOption.IGNORE_CASE))
  private val MODEL_INSTANCE =
    Regex("<model_instance\\b[^>]*>.*?</model_instance>", setOf(RegexOption.DOT_MATCHES_ALL, RegexOption.IGNORE_CASE))
  private val ASSEMBLE_ITEM = Regex("<assemble_item\\b[^>]*?/>", RegexOption.IGNORE_CASE)
  private val ASSEMBLE_ITEM_OBJECT_ID = Regex("\\bobject_id=\"(\\d+)\"", RegexOption.IGNORE_CASE)
  private val COMPONENT_PATH = Regex("<component\\b[^>]*\\bp:path=\"([^\"]+)\"", RegexOption.IGNORE_CASE)
  private val RELATIONSHIP = Regex("<Relationship\\b[^>]*\\bTarget=\"([^\"]+)\"[^>]*/?>", RegexOption.IGNORE_CASE)

  /** Plate definitions in file order. Empty when the 3MF isn't multi-plate. */
  fun readPlates(file: File): List<Plate> {
    val config = readEntryText(file, "Metadata/model_settings.config") ?: return emptyList()
    val plates = ArrayList<Plate>()
    var index = 0
    for (match in PLATE_BLOCK.findAll(config)) {
      index++
      val block = match.groupValues[1]
      var id = index
      var name = ""
      var thumbnail: String? = null
      for (meta in META.findAll(block)) {
        val key = meta.groupValues[1]
        val value = meta.groupValues[2]
        when (key) {
          "plater_id" -> value.toIntOrNull()?.let { id = it }
          "plater_name" -> name = value
          "thumbnail_file" -> if (value.isNotBlank()) thumbnail = value
        }
      }
      val objectIds = OBJECT_ID.findAll(block)
        .mapNotNull { it.groupValues[1].toIntOrNull() }
        .toList()
      plates.add(Plate(id, name.ifBlank { "Plate $id" }, objectIds, thumbnail))
    }
    return plates
  }

  /**
   * Repacks a single plate of [src] into [outFile] as a MINIMAL core-spec 3MF.
   *
   * PrusaSlicer's loadModel() is strict: it rejects production-extension files
   * (Bambu/Orca) that carry the BambuStudio namespace, Metadata plate_N.json,
   * Auxiliaries blobs, etc. So we emit only the three parts a core 3MF needs
   * ([Content_Types].xml, _rels/.rels, 3D/3dmodel.model), with the build
   * flattened to this plate's mesh objects.
   *
   * STREAMING: large 3MFs hold hundreds of MB of mesh data — a single
   * 3D/3dmodel.model can be ~400 MB (Bambu also splits geometry across 50 MB+
   * part files). Materializing any of that as a Java String blows the heap
   * (a char[] is ~2x the byte size, and the heap is capped at 256 MB). So we
   * never do: the object graph is built with a streaming XmlPullParser that
   * records only structure (component children, transforms, mesh presence) —
   * never vertex data — and each kept mesh is stream-copied element-by-element
   * from the source zip entry straight into the output writer. Peak memory is
   * bounded by the parser buffer, not the model size.
   *
   * Two mesh-storage shapes are supported transparently:
   *  - INLINE (OrcaSlicer / some Bambu): the leaf object carries its <mesh>
   *    inside 3D/3dmodel.model's <resources>.
   *  - EXTERNAL part files (Bambu production extension): the mesh lives only in
   *    a sibling 3D/Objects/object_N.model, referenced by a mesh-less group
   *    object via <component objectid="N" p:path="...">.
   */
  fun extractPlate(
    src: File,
    plate: Plate,
    outFile: File,
    onProgress: ((percent: Int, phase: String) -> Unit)? = null,
  ): File {
    val keep = plate.objectIds.toHashSet()
    onProgress?.invoke(2, "Opening archive…")
    ZipFile(src).use { zip ->
      val modelEntry = zip.getEntry("3D/3dmodel.model")
        ?: throw IllegalStateException("3D/3dmodel.model not found in ${src.name}")
      val modelSize = modelEntry.size.coerceAtLeast(0L)

      // PASS 1 — stream the object graph + build items (no mesh data buffered).
      val graph = HashMap<Int, ObjNode>()
      val items = ArrayList<BuildItem>()
      val rootUnit = arrayOf("millimeter", "") // [0]=unit, [1]=xml:lang
      val m1 = Meter(modelSize, 3, 27, onProgress).apply { phase = "Reading model structure…" }
      streamGraph(zip, modelEntry, graph, items, rootUnit, m1)
      if (items.isEmpty()) throw IllegalStateException("No <build> items in ${src.name}")
      onProgress?.invoke(31, "Resolving objects…")

      // Resolve the plate's leaves: DFS from kept build items, composing 3MF
      // row-vector transforms (combined = component x item). One output object
      // per UNIQUE source mesh (shared geometry -> one <object> + many <item>s);
      // items carry the composed transform so the mesh copies verbatim.
      val meshOutId = LinkedHashMap<MeshSrc, Int>()
      val outItems = ArrayList<OutItem>()
      var nextId = 0
      fun expand(objId: Int, xform: DoubleArray, printable: String?, partPath: String?, path: HashSet<Int>) {
        if (objId in path) return // cycle guard (3MF forbids cycles; defensive)
        val node = graph[objId]
        val subs = node?.components
        val hasOwnMesh = node?.hasMesh == true
        if (partPath == null && !hasOwnMesh && subs != null && subs.isNotEmpty()) {
          // Pure group object: recurse into its components, composing transforms.
          val nextPath = HashSet(path).apply { add(objId) }
          for (c in subs) {
            expand(c.sub, composeTransforms(parseTransform(c.transform), xform), printable, c.partPath, nextPath)
          }
        } else if (hasOwnMesh || partPath != null) {
          // Leaf mesh object: emit it (de-duplicated by source mesh).
          val outId = meshOutId.getOrPut(MeshSrc(partPath, objId)) { ++nextId }
          outItems.add(OutItem(outId, xform, printable))
        }
      }
      for (bi in items) {
        if (bi.objid in keep) expand(bi.objid, parseTransform(bi.transform), bi.printable, null, hashSetOf())
      }
      if (outItems.isEmpty()) throw IllegalStateException("Plate ${plate.id} has no printable objects")

      // PASS 2 — write the minimal 3MF, streaming each kept mesh verbatim.
      ZipOutputStream(outFile.outputStream().buffered()).use { zos ->
        writeEntry(zos, "[Content_Types].xml", MINIMAL_CONTENT_TYPES)
        writeEntry(zos, "_rels/.rels", MINIMAL_RELS)
        zos.putNextEntry(ZipEntry("3D/3dmodel.model"))
        val w = OutputStreamWriter(zos, Charsets.UTF_8)
        val langAttr = if (rootUnit[1].isNotEmpty()) " xml:lang=\"${rootUnit[1]}\"" else ""
        w.write("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n")
        w.write("<model unit=\""); w.write(rootUnit[0]); w.write("\""); w.write(langAttr)
        w.write(" xmlns=\"http://schemas.microsoft.com/3dmanufacturing/core/2015/02\">\n")
        w.write(" <resources>\n")
        // Group output meshes by source: inline (re-read 3dmodel.model) vs each
        // external part file. Then size the pass-2 progress meter against the
        // bytes we will actually stream (model size if any inline leaves, plus
        // each needed part file), so the bar reflects real, file-adaptive work.
        val pendingInline = HashMap<Int, Int>()
        for (k in meshOutId.keys) if (k.partPath == null) pendingInline[k.objId] = meshOutId[k]!!
        val byPart = LinkedHashMap<String, MutableMap<Int, Int>>()
        for ((k, outId) in meshOutId) {
          val p = k.partPath ?: continue
          byPart.getOrPut(p) { HashMap() }[k.objId] = outId
        }
        var p2Total = 0L
        if (pendingInline.isNotEmpty()) p2Total += modelSize
        for (p in byPart.keys) {
          val e = zip.getEntry(p.removePrefix("/")) ?: zip.getEntry(p)
          if (e != null) p2Total += e.size.coerceAtLeast(0L)
        }
        val m2 = Meter(p2Total, 34, 63, onProgress).apply { phase = "Extracting geometry…" }
        // Inline meshes: one more stream over 3D/3dmodel.model, copying each
        // kept object's <mesh> as the parser reaches it (document order).
        if (pendingInline.isNotEmpty()) streamInlineMeshes(zip, modelEntry, pendingInline, w, m2)
        // External part-file meshes: stream each needed part file once.
        for ((partPath, objs) in byPart) streamPartMeshes(zip, partPath, objs, w, m2)
        // Build items.
        w.write("\n </resources>\n <build>\n")
        for (oi in outItems) {
          w.write("  <item objectid=\""); w.write(oi.outId.toString())
          w.write("\" transform=\""); w.write(formatTransform(oi.xform)); w.write("\"")
          if (oi.printable != null) { w.write(" printable=\""); w.write(oi.printable); w.write("\"") }
          w.write(" />\n")
        }
        w.write(" </build>\n</model>\n")
        onProgress?.invoke(99, "Finalizing…")
        w.flush()
        zos.closeEntry()
      }
    }
    return outFile
  }

  private fun writeEntry(zos: ZipOutputStream, name: String, text: String) {
    zos.putNextEntry(ZipEntry(name))
    zos.write(text.toByteArray(Charsets.UTF_8))
    zos.closeEntry()
  }

  private val MINIMAL_CONTENT_TYPES =
    """<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
 <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
 <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>
</Types>
"""
  private val MINIMAL_RELS =
    """<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
 <Relationship Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel" Target="/3D/3dmodel.model"/>
</Relationships>
"""

  // ---- streaming mesh extraction helpers (namespaces OFF: we copy raw qnames) ----

  private fun newParser(input: InputStream): XmlPullParser {
    val factory = XmlPullParserFactory.newInstance().apply { isNamespaceAware = false }
    val parser = factory.newPullParser()
    parser.setInput(input, "UTF-8")
    return parser
  }

  /** Case-insensitive attribute lookup by raw qualified name (namespaces off). */
  private fun attrValue(parser: XmlPullParser, name: String): String? {
    for (i in 0 until parser.attributeCount) {
      if (parser.getAttributeName(i).equals(name, ignoreCase = true)) return parser.getAttributeValue(i)
    }
    return null
  }

  /** A component's external part-file path (p:path / any *:path / bare path). */
  private fun pathAttribute(parser: XmlPullParser): String? {
    for (i in 0 until parser.attributeCount) {
      val n = parser.getAttributeName(i)
      if (n.equals("p:path", ignoreCase = true) || n.endsWith(":path", ignoreCase = true) || n.equals("path", ignoreCase = true)) {
        return parser.getAttributeValue(i)
      }
    }
    return null
  }

  private data class ComponentRef(val sub: Int, val transform: String?, val partPath: String?)
  private data class ObjNode(val components: List<ComponentRef>, val hasMesh: Boolean)
  private data class BuildItem(val objid: Int, val transform: String?, val printable: String?)
  private data class MeshSrc(val partPath: String?, val objId: Int)
  private data class OutItem(val outId: Int, val xform: DoubleArray, val printable: String?)

  /**
   * Maps bytes read out of a stream to a determinate [base..base+span] percent
   * window and reports it through [onProgress] (only when the integer percent
   * actually changes, to keep bridge traffic down). Two meters cover the two
   * streaming passes: pass 1 (graph) over [3..30], pass 2 (meshes) over [34..97].
   */
  private class Meter(
    val total: Long,
    val base: Int,
    val span: Int,
    val onProgress: ((Int, String) -> Unit)?,
  ) {
    var phase: String = ""
    private var read = 0L
    private var lastPct = -1
    fun onBytes(n: Int) {
      if (n <= 0 || onProgress == null) return
      read += n
      val frac = if (total > 0) (read.toDouble() / total).coerceIn(0.0, 1.0) else 0.0
      val pct = (base + (span * frac)).toInt().coerceIn(0, 100)
      if (pct != lastPct) { lastPct = pct; onProgress(pct, phase) }
    }
  }

  /** InputStream that feeds every byte read into a [Meter] (for real progress). */
  private class CountingInputStream(inner: InputStream, private val meter: Meter?) : InputStream() {
    private val src = inner
    override fun read(): Int { val b = src.read(); if (b != -1) meter?.onBytes(1); return b }
    override fun read(b: ByteArray, off: Int, len: Int): Int {
      val n = src.read(b, off, len); if (n > 0) meter?.onBytes(n); return n
    }
    override fun available(): Int = try { src.available() } catch (_: Throwable) { 0 }
    override fun close() { src.close() }
  }

  /** Streams [entry] once, recording each object's component children + mesh presence, and the build items. */
  private fun streamGraph(
    zip: ZipFile,
    entry: ZipEntry,
    graph: HashMap<Int, ObjNode>,
    items: ArrayList<BuildItem>,
    rootUnit: Array<String>,
    meter: Meter?,
  ) {
    CountingInputStream(zip.getInputStream(entry), meter).use { input ->
      val parser = newParser(input.buffered())
      var ev = parser.eventType
      var inBuild = false
      var curObjId: Int? = null
      var curComps: ArrayList<ComponentRef>? = null
      var curHasMesh = false
      while (ev != XmlPullParser.END_DOCUMENT) {
        if (ev == XmlPullParser.START_TAG) {
          when (parser.name) {
            "model" -> {
              attrValue(parser, "unit")?.let { if (it.isNotBlank()) rootUnit[0] = it }
              attrValue(parser, "xml:lang")?.let { if (it.isNotBlank()) rootUnit[1] = it }
            }
            "object" -> {
              curObjId = attrValue(parser, "id")?.toIntOrNull()
              curComps = ArrayList()
              curHasMesh = false
            }
            "component" -> {
              val sub = attrValue(parser, "objectid")?.toIntOrNull()
              if (sub != null) {
                curComps?.add(ComponentRef(sub, attrValue(parser, "transform"), pathAttribute(parser)))
              }
            }
            "mesh" -> curHasMesh = true
            "build" -> inBuild = true
            "item" -> if (inBuild) {
              attrValue(parser, "objectid")?.toIntOrNull()?.let { id ->
                items.add(BuildItem(id, attrValue(parser, "transform"), attrValue(parser, "printable")))
              }
            }
          }
        } else if (ev == XmlPullParser.END_TAG) {
          when (parser.name) {
            "object" -> {
              if (curObjId != null) graph[curObjId!!] = ObjNode(curComps ?: emptyList(), curHasMesh)
              curObjId = null
              curComps = null
            }
            "build" -> inBuild = false
          }
        }
        ev = parser.next()
      }
    }
  }

  /** Streams [entry] (3D/3dmodel.model) copying each object whose id is in [pending] (id -> outId). */
  private fun streamInlineMeshes(zip: ZipFile, entry: ZipEntry, pending: Map<Int, Int>, w: Writer, meter: Meter?) {
    CountingInputStream(zip.getInputStream(entry), meter).use { input ->
      val parser = newParser(input.buffered())
      var ev = parser.eventType
      while (ev != XmlPullParser.END_DOCUMENT) {
        if (ev == XmlPullParser.START_TAG && parser.name == "object") {
          val id = attrValue(parser, "id")?.toIntOrNull()
          processObject(parser, w, if (id != null) pending[id] else null)
        }
        ev = parser.next()
      }
    }
  }

  /** Streams one external part file [partPath], copying each object whose id is in [objs] (id -> outId). */
  private fun streamPartMeshes(zip: ZipFile, partPath: String, objs: Map<Int, Int>, w: Writer, meter: Meter?) {
    val entry = zip.getEntry(partPath.removePrefix("/")) ?: zip.getEntry(partPath) ?: return
    CountingInputStream(zip.getInputStream(entry), meter).use { input ->
      val parser = newParser(input.buffered())
      var ev = parser.eventType
      while (ev != XmlPullParser.END_DOCUMENT) {
        if (ev == XmlPullParser.START_TAG && parser.name == "object") {
          val id = attrValue(parser, "id")?.toIntOrNull()
          processObject(parser, w, if (id != null) objs[id] else null)
        }
        ev = parser.next()
      }
    }
  }

  /**
   * pre: parser at START_TAG "object". post: parser at END_TAG "object".
   * When [outId] != null, writes `<object id=outId type=model>` + this object's
   * first `<mesh>` (stream-copied verbatim) + `</object>`. Otherwise skips it.
   */
  private fun processObject(parser: XmlPullParser, w: Writer, outId: Int?) {
    if (outId == null) { skipToEndTag(parser, "object"); return }
    var ev = parser.next()
    while (ev != XmlPullParser.END_TAG) {
      if (ev == XmlPullParser.START_TAG && parser.name == "mesh") {
        w.write("<object id=\""); w.write(outId.toString()); w.write("\" type=\"model\">\n")
        copyElement(parser, w)
        w.write("\n</object>\n")
        skipToEndTag(parser, "object")
        return
      }
      ev = parser.next()
    }
  }

  /**
   * pre: parser at START_TAG of an element. Writes that element and its full
   * subtree verbatim (self-closing form preserved, so mesh output stays the
   * same size as the source). post: parser at the element's END_TAG.
   */
  private fun copyElement(parser: XmlPullParser, w: Writer) {
    val name = parser.name
    w.write('<'.code); w.write(name)
    val ac = parser.attributeCount
    for (i in 0 until ac) {
      w.write(' '.code); w.write(parser.getAttributeName(i)); w.write("=\""); w.write(esc(parser.getAttributeValue(i))); w.write('"'.code)
    }
    if (parser.isEmptyElementTag) { w.write("/>"); parser.next(); return }
    w.write('>'.code)
    var ev = parser.next()
    while (ev != XmlPullParser.END_TAG) {
      when (ev) {
        XmlPullParser.START_TAG -> copyElement(parser, w)
        XmlPullParser.TEXT -> { val t = parser.text; if (t != null && t.isNotEmpty()) w.write(esc(t)) }
        XmlPullParser.END_DOCUMENT -> return
      }
      ev = parser.next()
    }
    w.write("</"); w.write(name); w.write('>'.code)
  }

  /** Advances until the END_TAG of [name]; leaves parser positioned there. */
  private fun skipToEndTag(parser: XmlPullParser, name: String) {
    var ev = parser.next()
    while (ev != XmlPullParser.END_DOCUMENT) {
      if (ev == XmlPullParser.END_TAG && parser.name == name) return
      ev = parser.next()
    }
  }

  private fun esc(s: String): String =
    if (s.indexOf('"') < 0 && s.indexOf('&') < 0 && s.indexOf('<') < 0 && s.indexOf('>') < 0) s
    else s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace("\"", "&quot;")

  /**
   * Writes a copy of [src] to [outFile] with the [index]-th <build><item> removed
   * (used by the prepare screen's Delete). Returns false — and leaves no useful
   * output — when the model has 0/1 items or the index is out of range.
   *
   * Production-extension 3MFs (Bambu/Orca) split each object's mesh into its own
   * part file (3D/Objects/object_N.model), referenced from the root model via
   * <component p:path="..."> and declared in 3D/_rels/3dmodel.model.rels. Dropping
   * the <item>+<object> alone leaves that part file's relationship dangling, which
   * the native loader rejects — so we also drop the orphaned part file and its
   * relationship entry.
   */
  private data class DropResult(
    val xml: String,
    val removed: Boolean,
    val orphanedPaths: Set<String>,
    val removedObjectId: Int?,
  )

  fun removeBuildItem(src: File, index: Int, outFile: File): Boolean {
    var result: DropResult? = null
    ZipFile(src).use { zip ->
      val modelEntry = zip.getEntry("3D/3dmodel.model")
      if (modelEntry != null) {
        val xml = zip.getInputStream(modelEntry).bufferedReader().use { it.readText() }
        result = dropBuildItem(xml, index)
      }
      val res = result
      if (res == null || !res.removed) return false

      val skipEntries = res.orphanedPaths.map { it.removePrefix("/") }.toHashSet()
      ZipOutputStream(outFile.outputStream().buffered()).use { out ->
        val entries = zip.entries()
        while (entries.hasMoreElements()) {
          val entry = entries.nextElement()
          if (entry.isDirectory || entry.name in skipEntries) continue
          out.putNextEntry(ZipEntry(entry.name))
          when {
            entry.name.equals("3D/3dmodel.model", ignoreCase = true) -> {
              out.write(res.xml.toByteArray())
            }
            entry.name.equals("3D/_rels/3dmodel.model.rels", ignoreCase = true) && res.orphanedPaths.isNotEmpty() -> {
              val rels = zip.getInputStream(entry).bufferedReader().use { it.readText() }
              out.write(dropRelationships(rels, res.orphanedPaths).toByteArray())
            }
            entry.name.equals("Metadata/model_settings.config", ignoreCase = true) && res.removedObjectId != null -> {
              val config = zip.getInputStream(entry).bufferedReader().use { it.readText() }
              out.write(dropConfigObject(config, res.removedObjectId!!).toByteArray())
            }
            else -> zip.getInputStream(entry).use { it.copyTo(out) }
          }
          out.closeEntry()
        }
      }
    }
    return true
  }

  /** Drops <Relationship> entries whose Target matches one of [targets] (leading-slash tolerant). */
  private fun dropRelationships(xml: String, targets: Set<String>): String {
    val normalized = targets.map { it.removePrefix("/") }.toHashSet()
    return RELATIONSHIP.replace(xml) { m ->
      if (m.groupValues[1].removePrefix("/") in normalized) "" else m.value
    }
  }

  /**
   * Metadata/model_settings.config duplicates the object/plate/assembly wiring
   * independently of 3D/3dmodel.model (that's how the plate picker maps objects
   * to plates at all) — so a deleted object needs to come out here too, or the
   * config keeps pointing at an object_id that no longer exists anywhere.
   */
  private fun dropConfigObject(xml: String, objectId: Int): String {
    var out = OBJECT_BLOCK.replace(xml) { m -> if (m.groupValues[1].toIntOrNull() == objectId) "" else m.value }
    out = MODEL_INSTANCE.replace(out) { m ->
      if (OBJECT_ID.find(m.value)?.groupValues?.get(1)?.toIntOrNull() == objectId) "" else m.value
    }
    out = ASSEMBLE_ITEM.replace(out) { m ->
      if (ASSEMBLE_ITEM_OBJECT_ID.find(m.value)?.groupValues?.get(1)?.toIntOrNull() == objectId) "" else m.value
    }
    return out
  }

  private fun dropBuildItem(xml: String, index: Int): DropResult {
    val match = BUILD_BLOCK.find(xml) ?: return DropResult(xml, false, emptySet(), null)
    val open = match.groupValues[1]
    val body = match.groupValues[2]
    val close = match.groupValues[3]
    val items = ITEM.findAll(body).map { it.value }.toList()
    if (items.size <= 1 || index !in items.indices) return DropResult(xml, false, emptySet(), null)

    val removedObjectId = ITEM_OBJECT_ID.find(items[index])?.groupValues?.get(1)?.toIntOrNull()

    val kept = StringBuilder()
    items.forEachIndexed { i, item -> if (i != index) kept.append("\n  ").append(item.trim()) }
    var rebuilt = xml.substring(0, match.range.first) +
      open + kept.toString() + "\n " + close +
      xml.substring(match.range.last + 1)

    // 3MF requires every <resources><object> to be referenced by a build item or
    // a component — dropping the item alone leaves its object orphaned, which our
    // (strict) native loader rejects outright. Drop the object resource too, but
    // only if nothing else still points at it (another item, or a component of a
    // still-present assembly object).
    var orphanedPaths = emptySet<String>()
    if (removedObjectId != null && !Regex("objectid=\"$removedObjectId\"", RegexOption.IGNORE_CASE).containsMatchIn(rebuilt)) {
      rebuilt = OBJECT_BLOCK.replace(rebuilt) { m ->
        if (m.groupValues[1].toIntOrNull() == removedObjectId) {
          orphanedPaths = COMPONENT_PATH.findAll(m.value).map { it.groupValues[1] }.toHashSet()
          ""
        } else {
          m.value
        }
      }
    }
    return DropResult(rebuilt, true, orphanedPaths, removedObjectId)
  }

  /** The plate thumbnail PNG as a data: URI, or null. */
  fun readThumbnailDataUri(file: File, entry: String?): String? {
    if (entry.isNullOrBlank()) return null
    val bytes = readEntryBytes(file, entry) ?: return null
    return "data:image/png;base64," + android.util.Base64.encodeToString(bytes, android.util.Base64.NO_WRAP)
  }

  /** Parse a 3MF 3×4 transform (12 row-major values); identity when absent. */
  private fun parseTransform(s: String?): DoubleArray {
    val t = DoubleArray(12)
    t[0] = 1.0; t[4] = 1.0; t[8] = 1.0
    if (s.isNullOrBlank()) return t
    val parts = s.trim().split(Regex("\\s+"))
    for (i in 0 until minOf(12, parts.size)) t[i] = parts[i].toDoubleOrNull() ?: t[i]
    return t
  }

  /**
   * Compose two 3MF transforms as augmented 4×4 matrices (row-vector
   * convention). Result = A×B, i.e. "apply B first, then A" — pass
   * (component, item) so a point maps component-local → object-space → world.
   */
  private fun composeTransforms(a: DoubleArray, b: DoubleArray): DoubleArray {
    val r = DoubleArray(12)
    for (i in 0..3) {
      for (j in 0..2) {
        var sum = 0.0
        for (k in 0..2) sum += a[i * 3 + k] * b[k * 3 + j]
        if (i == 3) sum += b[9 + j]
        r[i * 3 + j] = sum
      }
    }
    return r
  }

  private fun formatTransform(t: DoubleArray): String = t.joinToString(" ") { fmtFloat(it) }

  private fun fmtFloat(v: Double): String {
    if (kotlin.math.abs(v) < 1e-12) return "0"
    if (v.toInt().toDouble() == v) return v.toInt().toString()
    return "%.7g".format(v)
  }

  private fun readEntryText(file: File, entryName: String): String? = try {
    ZipFile(file).use { zip ->
      zip.getEntry(entryName)?.let { entry ->
        zip.getInputStream(entry).bufferedReader().use { it.readText() }
      }
    }
  } catch (_: Throwable) {
    null
  }

  private fun readEntryBytes(file: File, entryName: String): ByteArray? = try {
    ZipFile(file).use { zip ->
      zip.getEntry(entryName)?.let { entry ->
        zip.getInputStream(entry).use { it.readBytes() }
      }
    }
  } catch (_: Throwable) {
    null
  }
}
