package com.sbtltv.sbtlnative

import android.os.Debug
import android.os.StatFs
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class SizeCap : CodedException("ERR_SIZE_CAP", "size cap exceeded", null)
class GzipFailed(cause: Throwable) : CodedException("ERR_GZIP", cause.message ?: "not a gzip file", cause)

class SbtlNativeModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("SbtlNative")
    Function("hello") { "sbtl-native" }
    // AsyncFunction runs off the JS thread.
    AsyncFunction("fetchToFile") { url: String, dest: String, maxBytes: Double ->
      try { val r = Transfers.fetchToFile(url, dest, maxBytes.toLong()); mapOf("status" to r.status, "location" to r.location, "bytes" to r.bytes.toDouble()) }
      catch (e: SizeCapException) { throw SizeCap() }
    }
    AsyncFunction("gunzipFile") { src: String, dest: String, maxBytes: Double ->
      try { Transfers.gunzipFile(src, dest, maxBytes.toLong()) } catch (e: SizeCapException) { throw SizeCap() } catch (e: java.io.IOException) { throw GzipFailed(e) }
    }
    Function("memoryInfo") {
      val mi = Debug.MemoryInfo(); Debug.getMemoryInfo(mi)
      val ctx = appContext.reactContext!!
      val rssKb = java.io.File("/proc/self/status").readLines().firstOrNull { it.startsWith("VmRSS:") }?.filter { it.isDigit() }?.toLongOrNull() ?: -1
      mapOf("pssKb" to mi.totalPss.toDouble(), "rssKb" to rssKb.toDouble(), "freeDiskBytes" to StatFs(ctx.filesDir.path).availableBytes.toDouble())
    }
  }
}
