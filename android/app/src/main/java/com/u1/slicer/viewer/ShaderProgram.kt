package com.u1.slicer.viewer

import android.content.Context
import android.opengl.GLES30
import android.util.Log

class ShaderProgram(
    context: Context,
    vertexAsset: String,
    fragmentAsset: String
) {
    val programId: Int

    init {
        val vertSource = context.assets.open(vertexAsset).bufferedReader().readText()
        val fragSource = context.assets.open(fragmentAsset).bufferedReader().readText()

        val vertShader = compileShader(GLES30.GL_VERTEX_SHADER, vertSource)
        val fragShader = compileShader(GLES30.GL_FRAGMENT_SHADER, fragSource)

        programId = GLES30.glCreateProgram()
        GLES30.glAttachShader(programId, vertShader)
        GLES30.glAttachShader(programId, fragShader)
        GLES30.glLinkProgram(programId)

        val linkStatus = IntArray(1)
        GLES30.glGetProgramiv(programId, GLES30.GL_LINK_STATUS, linkStatus, 0)
        if (linkStatus[0] == 0) {
            val info = GLES30.glGetProgramInfoLog(programId)
            GLES30.glDeleteProgram(programId)
            throw RuntimeException("Shader link failed: $info")
        }

        GLES30.glDeleteShader(vertShader)
        GLES30.glDeleteShader(fragShader)
    }

    fun use() {
        GLES30.glUseProgram(programId)
    }

    fun getUniformLocation(name: String): Int {
        return GLES30.glGetUniformLocation(programId, name)
    }

    private fun compileShader(type: Int, source: String): Int {
        val shader = GLES30.glCreateShader(type)
        GLES30.glShaderSource(shader, source)
        GLES30.glCompileShader(shader)

        val status = IntArray(1)
        GLES30.glGetShaderiv(shader, GLES30.GL_COMPILE_STATUS, status, 0)
        if (status[0] == 0) {
            val info = GLES30.glGetShaderInfoLog(shader)
            GLES30.glDeleteShader(shader)
            val typeName = if (type == GLES30.GL_VERTEX_SHADER) "vertex" else "fragment"
            throw RuntimeException("$typeName shader compile failed: $info")
        }
        return shader
    }

    fun delete() {
        GLES30.glDeleteProgram(programId)
    }
}
