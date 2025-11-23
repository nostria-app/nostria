import { Injectable } from '@angular/core';

export interface VideoFilter {
  id: string;
  name: string;
  icon: string;
  description: string;
}

@Injectable({
  providedIn: 'root'
})
export class VideoFilterService {
  private gl: WebGLRenderingContext | null = null;
  private program: WebGLProgram | null = null;
  private textureCoordBuffer: WebGLBuffer | null = null;
  private positionBuffer: WebGLBuffer | null = null;
  private texture: WebGLTexture | null = null;
  private currentFilter = 'none';

  readonly availableFilters: VideoFilter[] = [
    { id: 'none', name: 'None', icon: 'filter_none', description: 'No filter applied' },
    { id: 'grayscale', name: 'Grayscale', icon: 'filter_b_and_w', description: 'Black and white effect' },
    { id: 'sepia', name: 'Sepia', icon: 'filter_vintage', description: 'Vintage warm tone' },
    { id: 'invert', name: 'Invert', icon: 'invert_colors', description: 'Inverted colors' },
    { id: 'edge', name: 'Edge Detect', icon: 'auto_fix_high', description: 'Traced/cartoon outline' },
    { id: 'cartoon', name: 'Cartoon', icon: 'brush', description: 'Posterized cartoon style' },
    { id: 'blur', name: 'Blur/Beautify', icon: 'blur_on', description: 'Soft focus effect' },
    { id: 'sharpen', name: 'Sharpen', icon: 'tune', description: 'Enhanced details' },
    { id: 'brightness', name: 'Brighten', icon: 'brightness_high', description: 'Increased brightness' },
    { id: 'contrast', name: 'Contrast', icon: 'contrast', description: 'Enhanced contrast' },
    { id: 'vignette', name: 'Vignette', icon: 'vignette', description: 'Dark edge fade' },
    { id: 'warmth', name: 'Warmth', icon: 'wb_sunny', description: 'Warm color temperature' },
    { id: 'cool', name: 'Cool', icon: 'ac_unit', description: 'Cool color temperature' },
    { id: 'pixelate', name: 'Pixelate', icon: 'grid_on', description: 'Pixel art effect' },
  ];

  initWebGL(canvas: HTMLCanvasElement): boolean {
    try {
      this.gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl') as WebGLRenderingContext;
      if (!this.gl) {
        console.error('WebGL not supported');
        return false;
      }

      // Set up shaders and program
      this.setupShaders();
      this.setupBuffers();
      this.setupTexture();

      return true;
    } catch (e) {
      console.error('Error initializing WebGL:', e);
      return false;
    }
  }

  private setupShaders(): void {
    if (!this.gl) return;

    const vertexShaderSource = `
      attribute vec2 a_position;
      attribute vec2 a_texCoord;
      varying vec2 v_texCoord;
      
      void main() {
        gl_Position = vec4(a_position, 0.0, 1.0);
        v_texCoord = a_texCoord;
      }
    `;

    const fragmentShaderSource = `
      precision mediump float;
      varying vec2 v_texCoord;
      uniform sampler2D u_image;
      uniform int u_filter;
      
      vec3 grayscale(vec3 color) {
        float gray = dot(color, vec3(0.299, 0.587, 0.114));
        return vec3(gray);
      }
      
      vec3 sepia(vec3 color) {
        return vec3(
          dot(color, vec3(0.393, 0.769, 0.189)),
          dot(color, vec3(0.349, 0.686, 0.168)),
          dot(color, vec3(0.272, 0.534, 0.131))
        );
      }
      
      vec3 invert(vec3 color) {
        return vec3(1.0) - color;
      }
      
      vec3 edgeDetect(sampler2D image, vec2 texCoord) {
        vec2 texelSize = vec2(1.0 / 640.0, 1.0 / 480.0);
        float kernel[9];
        kernel[0] = -1.0; kernel[1] = -1.0; kernel[2] = -1.0;
        kernel[3] = -1.0; kernel[4] =  8.0; kernel[5] = -1.0;
        kernel[6] = -1.0; kernel[7] = -1.0; kernel[8] = -1.0;
        
        vec3 sum = vec3(0.0);
        for (int i = -1; i <= 1; i++) {
          for (int j = -1; j <= 1; j++) {
            vec2 offset = vec2(float(i), float(j)) * texelSize;
            sum += texture2D(image, texCoord + offset).rgb * kernel[(i+1)*3 + (j+1)];
          }
        }
        return sum;
      }
      
      vec3 cartoon(vec3 color) {
        // Posterize effect
        float levels = 5.0;
        return floor(color * levels) / levels;
      }
      
      vec3 blur(sampler2D image, vec2 texCoord) {
        vec2 texelSize = vec2(1.0 / 640.0, 1.0 / 480.0);
        vec3 sum = vec3(0.0);
        float kernel[9];
        kernel[0] = 1.0/16.0; kernel[1] = 2.0/16.0; kernel[2] = 1.0/16.0;
        kernel[3] = 2.0/16.0; kernel[4] = 4.0/16.0; kernel[5] = 2.0/16.0;
        kernel[6] = 1.0/16.0; kernel[7] = 2.0/16.0; kernel[8] = 1.0/16.0;
        
        for (int i = -1; i <= 1; i++) {
          for (int j = -1; j <= 1; j++) {
            vec2 offset = vec2(float(i), float(j)) * texelSize * 2.0;
            sum += texture2D(image, texCoord + offset).rgb * kernel[(i+1)*3 + (j+1)];
          }
        }
        return sum;
      }
      
      vec3 sharpen(sampler2D image, vec2 texCoord) {
        vec2 texelSize = vec2(1.0 / 640.0, 1.0 / 480.0);
        float kernel[9];
        kernel[0] =  0.0; kernel[1] = -1.0; kernel[2] =  0.0;
        kernel[3] = -1.0; kernel[4] =  5.0; kernel[5] = -1.0;
        kernel[6] =  0.0; kernel[7] = -1.0; kernel[8] =  0.0;
        
        vec3 sum = vec3(0.0);
        for (int i = -1; i <= 1; i++) {
          for (int j = -1; j <= 1; j++) {
            vec2 offset = vec2(float(i), float(j)) * texelSize;
            sum += texture2D(image, texCoord + offset).rgb * kernel[(i+1)*3 + (j+1)];
          }
        }
        return sum;
      }
      
      vec3 adjustBrightness(vec3 color, float amount) {
        return color + amount;
      }
      
      vec3 adjustContrast(vec3 color, float amount) {
        return (color - 0.5) * (1.0 + amount) + 0.5;
      }
      
      vec3 vignette(vec3 color, vec2 texCoord) {
        vec2 position = texCoord - vec2(0.5);
        float dist = length(position);
        float vignette = smoothstep(0.8, 0.4, dist);
        return color * vignette;
      }
      
      vec3 warmth(vec3 color) {
        return color * vec3(1.1, 1.0, 0.9);
      }
      
      vec3 cool(vec3 color) {
        return color * vec3(0.9, 1.0, 1.1);
      }
      
      vec3 pixelate(sampler2D image, vec2 texCoord) {
        float pixelSize = 0.01;
        vec2 coord = floor(texCoord / pixelSize) * pixelSize;
        return texture2D(image, coord).rgb;
      }
      
      void main() {
        vec4 color = texture2D(u_image, v_texCoord);
        vec3 result = color.rgb;
        
        if (u_filter == 1) {
          result = grayscale(result);
        } else if (u_filter == 2) {
          result = sepia(result);
        } else if (u_filter == 3) {
          result = invert(result);
        } else if (u_filter == 4) {
          result = edgeDetect(u_image, v_texCoord);
        } else if (u_filter == 5) {
          result = cartoon(result);
        } else if (u_filter == 6) {
          result = blur(u_image, v_texCoord);
        } else if (u_filter == 7) {
          result = sharpen(u_image, v_texCoord);
        } else if (u_filter == 8) {
          result = adjustBrightness(result, 0.2);
        } else if (u_filter == 9) {
          result = adjustContrast(result, 0.3);
        } else if (u_filter == 10) {
          result = vignette(result, v_texCoord);
        } else if (u_filter == 11) {
          result = warmth(result);
        } else if (u_filter == 12) {
          result = cool(result);
        } else if (u_filter == 13) {
          result = pixelate(u_image, v_texCoord);
        }
        
        gl_FragColor = vec4(result, color.a);
      }
    `;

    const vertexShader = this.createShader(this.gl, this.gl.VERTEX_SHADER, vertexShaderSource);
    const fragmentShader = this.createShader(this.gl, this.gl.FRAGMENT_SHADER, fragmentShaderSource);

    if (!vertexShader || !fragmentShader) {
      console.error('Failed to create shaders');
      return;
    }

    this.program = this.gl.createProgram()!;
    this.gl.attachShader(this.program, vertexShader);
    this.gl.attachShader(this.program, fragmentShader);
    this.gl.linkProgram(this.program);

    if (!this.gl.getProgramParameter(this.program, this.gl.LINK_STATUS)) {
      console.error('Program link failed:', this.gl.getProgramInfoLog(this.program));
      return;
    }
  }

  private createShader(gl: WebGLRenderingContext, type: number, source: string): WebGLShader | null {
    const shader = gl.createShader(type);
    if (!shader) return null;

    gl.shaderSource(shader, source);
    gl.compileShader(shader);

    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      console.error('Shader compile failed:', gl.getShaderInfoLog(shader));
      gl.deleteShader(shader);
      return null;
    }

    return shader;
  }

  private setupBuffers(): void {
    if (!this.gl || !this.program) return;

    // Position buffer (full screen quad)
    this.positionBuffer = this.gl.createBuffer();
    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.positionBuffer);
    const positions = new Float32Array([
      -1, -1,
       1, -1,
      -1,  1,
       1,  1,
    ]);
    this.gl.bufferData(this.gl.ARRAY_BUFFER, positions, this.gl.STATIC_DRAW);

    // Texture coordinate buffer
    this.textureCoordBuffer = this.gl.createBuffer();
    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.textureCoordBuffer);
    const texCoords = new Float32Array([
      0, 1,
      1, 1,
      0, 0,
      1, 0,
    ]);
    this.gl.bufferData(this.gl.ARRAY_BUFFER, texCoords, this.gl.STATIC_DRAW);
  }

  private setupTexture(): void {
    if (!this.gl) return;

    this.texture = this.gl.createTexture();
    this.gl.bindTexture(this.gl.TEXTURE_2D, this.texture);
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_S, this.gl.CLAMP_TO_EDGE);
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_T, this.gl.CLAMP_TO_EDGE);
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MIN_FILTER, this.gl.LINEAR);
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MAG_FILTER, this.gl.LINEAR);
  }

  setFilter(filterId: string): void {
    this.currentFilter = filterId;
  }

  getFilterIndex(filterId: string): number {
    const filterIds = ['none', 'grayscale', 'sepia', 'invert', 'edge', 'cartoon', 'blur', 'sharpen', 'brightness', 'contrast', 'vignette', 'warmth', 'cool', 'pixelate'];
    return filterIds.indexOf(filterId);
  }

  applyFilter(video: HTMLVideoElement, canvas: HTMLCanvasElement): void {
    if (!this.gl || !this.program) return;

    const filterIndex = this.getFilterIndex(this.currentFilter);

    // Update canvas size to match video
    if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      this.gl.viewport(0, 0, canvas.width, canvas.height);
    }

    // Upload video frame to texture
    this.gl.bindTexture(this.gl.TEXTURE_2D, this.texture);
    this.gl.texImage2D(this.gl.TEXTURE_2D, 0, this.gl.RGBA, this.gl.RGBA, this.gl.UNSIGNED_BYTE, video);

    // Use program
    this.gl.useProgram(this.program);

    // Set position attribute
    const positionLocation = this.gl.getAttribLocation(this.program, 'a_position');
    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.positionBuffer);
    this.gl.enableVertexAttribArray(positionLocation);
    this.gl.vertexAttribPointer(positionLocation, 2, this.gl.FLOAT, false, 0, 0);

    // Set texture coordinate attribute
    const texCoordLocation = this.gl.getAttribLocation(this.program, 'a_texCoord');
    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.textureCoordBuffer);
    this.gl.enableVertexAttribArray(texCoordLocation);
    this.gl.vertexAttribPointer(texCoordLocation, 2, this.gl.FLOAT, false, 0, 0);

    // Set uniforms
    const imageLocation = this.gl.getUniformLocation(this.program, 'u_image');
    const filterLocation = this.gl.getUniformLocation(this.program, 'u_filter');
    this.gl.uniform1i(imageLocation, 0);
    this.gl.uniform1i(filterLocation, filterIndex);

    // Draw
    this.gl.drawArrays(this.gl.TRIANGLE_STRIP, 0, 4);
  }

  cleanup(): void {
    if (this.gl) {
      if (this.program) {
        this.gl.deleteProgram(this.program);
        this.program = null;
      }
      if (this.positionBuffer) {
        this.gl.deleteBuffer(this.positionBuffer);
        this.positionBuffer = null;
      }
      if (this.textureCoordBuffer) {
        this.gl.deleteBuffer(this.textureCoordBuffer);
        this.textureCoordBuffer = null;
      }
      if (this.texture) {
        this.gl.deleteTexture(this.texture);
        this.texture = null;
      }
    }
    this.gl = null;
  }
}
