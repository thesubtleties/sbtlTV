package com.sbtltv.sbtlnative

import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.File
import java.io.IOException
import java.util.concurrent.TimeUnit
import java.util.zip.GZIPInputStream

class SizeCapException : IOException("size cap exceeded")
data class FetchResult(val status: Int, val location: String?, val bytes: Long)

object Transfers {
  // One hop only: the redirect loop and the LAN guard live in TypeScript (net.ts), so they are the shared code's.
  private val client = OkHttpClient.Builder().followRedirects(false).followSslRedirects(false)
    .connectTimeout(30, TimeUnit.SECONDS).readTimeout(120, TimeUnit.SECONDS).build()

  fun fetchToFile(url: String, dest: String, maxBytes: Long): FetchResult {
    val req = Request.Builder().url(url).header("Accept-Encoding", "identity").header("Cache-Control", "no-cache").build()
    client.newCall(req).execute().use { res ->
      val code = res.code
      if (code in 300..399) return FetchResult(code, res.header("Location"), 0)
      if (code !in 200..299) return FetchResult(code, null, 0)
      val out = File(dest)
      try {
        var total = 0L
        res.body!!.byteStream().use { input -> out.outputStream().use { o ->
          val buf = ByteArray(64 * 1024)
          while (true) { val n = input.read(buf); if (n < 0) break; total += n; if (total > maxBytes) throw SizeCapException(); o.write(buf, 0, n) }
        } }
        return FetchResult(code, null, total)
      } catch (e: Exception) { out.delete(); throw e }
    }
  }

  fun gunzipFile(src: String, dest: String, maxBytes: Long) {
    val out = File(dest)
    try {
      var total = 0L
      GZIPInputStream(File(src).inputStream().buffered(), 64 * 1024).use { input -> out.outputStream().use { o ->
        val buf = ByteArray(64 * 1024)
        while (true) { val n = input.read(buf); if (n < 0) break; total += n; if (total > maxBytes) throw SizeCapException(); o.write(buf, 0, n) }
      } }
    } catch (e: Exception) { out.delete(); throw e }
  }
}
