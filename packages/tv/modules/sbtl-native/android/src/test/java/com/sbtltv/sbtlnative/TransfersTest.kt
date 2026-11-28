package com.sbtltv.sbtlnative

import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okio.Buffer
import org.junit.Assert.*
import org.junit.Test
import java.io.File
import java.util.zip.GZIPOutputStream

class TransfersTest {
  private fun tmp(name: String) = File.createTempFile("sbtl-test", name).also { it.delete() }

  @Test fun `a redirect returns its location and writes nothing`() {
    MockWebServer().use { s ->
      s.enqueue(MockResponse().setResponseCode(302).addHeader("Location", "http://elsewhere/x"))
      val dest = tmp("r")
      val r = Transfers.fetchToFile(s.url("/a").toString(), dest.path, 1000)
      assertEquals(302, r.status); assertEquals("http://elsewhere/x", r.location); assertFalse(dest.exists())
    }
  }
  @Test fun `a 200 streams the body with identity encoding and no-cache`() {
    MockWebServer().use { s ->
      s.enqueue(MockResponse().setBody("hello"))
      val dest = tmp("o")
      val r = Transfers.fetchToFile(s.url("/a").toString(), dest.path, 1000)
      assertEquals(200, r.status); assertEquals(5L, r.bytes); assertEquals("hello", dest.readText())
      val req = s.takeRequest(); assertEquals("identity", req.getHeader("Accept-Encoding")); assertEquals("no-cache", req.getHeader("Cache-Control"))
    }
  }
  @Test fun `cap deletes the file`() {
    MockWebServer().use { s ->
      s.enqueue(MockResponse().setBody("x".repeat(5000)))
      val dest = tmp("c")
      val e = assertThrows(SizeCapException::class.java) { Transfers.fetchToFile(s.url("/a").toString(), dest.path, 100) }
      assertNotNull(e); assertFalse(dest.exists())
    }
  }
  @Test fun `a 404 writes nothing`() {
    MockWebServer().use { s ->
      s.enqueue(MockResponse().setResponseCode(404))
      val dest = tmp("n")
      assertEquals(404, Transfers.fetchToFile(s.url("/a").toString(), dest.path, 100).status); assertFalse(dest.exists())
    }
  }
  @Test fun `gunzip inflates and its cap deletes`() {
    val src = tmp("g").also { f -> GZIPOutputStream(f.outputStream()).use { it.write("y".repeat(5000).toByteArray()) } }
    val ok = tmp("ok"); Transfers.gunzipFile(src.path, ok.path, 10_000); assertEquals(5000L, ok.length())
    val capped = tmp("cap")
    assertThrows(SizeCapException::class.java) { Transfers.gunzipFile(src.path, capped.path, 100) }; assertFalse(capped.exists())
    val notGz = tmp("ng").also { it.writeText("plain") }; val out = tmp("ngo")
    assertThrows(java.io.IOException::class.java) { Transfers.gunzipFile(notGz.path, out.path, 100) }; assertFalse(out.exists())
  }
}
