import { Injectable } from '@angular/core';

export interface VideoFilter {
  id: string;
  name: string;
  icon: string;
  description: string;
}

export interface PhotoAdjustments {
  brightness: number;   // -100 to 100
  contrast: number;     // -100 to 100
  fade: number;         // 0 to 100
  saturation: number;   // -100 to 100
  temperature: number;  // -100 to 100
  vignette: number;     // 0 to 100
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
  private filterIntensity = 1.0; // 0-1
  private adjustments: PhotoAdjustments = {
    brightness: 0,
    contrast: 0,
    fade: 0,
    saturation: 0,
    temperature: 0,
    vignette: 0,
  };
  private canvas: HTMLCanvasElement | null = null;
  private currentWidth = 0;
  private currentHeight = 0;
  private currentTexCoords = { left: 0, right: 1, top: 0, bottom: 1 };
  private startTime = performance.now();

  readonly availableFilters: VideoFilter[] = [
    { id: 'none', name: 'None', icon: 'filter_none', description: 'No filter applied' },
    { id: 'grayscale', name: 'Grayscale', icon: 'filter_b_and_w', description: 'Black and white effect' },
    { id: 'sepia', name: 'Sepia', icon: 'filter_vintage', description: 'Vintage warm tone' },
    { id: 'invert', name: 'Invert', icon: 'invert_colors', description: 'Inverted colors' },
    { id: 'edge', name: 'Edge Detect', icon: 'auto_fix_high', description: 'Traced/cartoon outline' },
    { id: 'cartoon', name: 'Cartoon', icon: 'brush', description: 'Posterized cartoon style' },
    { id: 'blur', name: 'Blur/Beautify', icon: 'blur_on', description: 'Soft focus effect' },
    { id: 'sharpen', name: 'Sharpen', icon: 'tune', description: 'Enhanced details' },
    { id: 'brightness', name: 'Brighten', icon: 'brightness_6', description: 'Increased brightness' },
    { id: 'contrast', name: 'High Contrast', icon: 'contrast', description: 'Enhanced contrast' },
    { id: 'vignette', name: 'Vignette', icon: 'vignette', description: 'Dark edges' },
    { id: 'warm', name: 'Warm', icon: 'whatshot', description: 'Warm tone' },
    { id: 'cool', name: 'Cool', icon: 'ac_unit', description: 'Cool tone' },
    { id: 'pixelate', name: 'Pixelate', icon: 'grid_on', description: 'Pixel art effect' },
  ];

  setFilterIntensity(intensity: number): void {
    this.filterIntensity = Math.max(0, Math.min(1, intensity));
  }

  setAdjustments(adj: PhotoAdjustments): void {
    this.adjustments = { ...adj };
  }

  initWebGL(canvas: HTMLCanvasElement): boolean {
    try {
      this.canvas = canvas;
      this.gl = canvas.getContext('webgl', { preserveDrawingBuffer: true }) ||
        canvas.getContext('experimental-webgl', { preserveDrawingBuffer: true }) as WebGLRenderingContext;
      if (!this.gl) {
        console.error('WebGL not supported');
        return false;
      }

      // Set up shaders and program
      if (!this.setupShaders()) {
        console.error('Failed to setup shaders');
        return false;
      }
      this.setupBuffers();
      this.setupTexture();

      console.log('[VideoFilter] WebGL initialized successfully');
      return true;
    } catch (e) {
      console.error('Error initializing WebGL:', e);
      return false;
    }
  }

  private cleanupWebGLResources(): void {
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
  }

  private setupShaders(): boolean {
    if (!this.gl) return false;

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
      uniform vec2 u_resolution;
      uniform float u_time;
      uniform float u_filterIntensity;
      uniform float u_brightness;
      uniform float u_contrast;
      uniform float u_fade;
      uniform float u_saturation;
      uniform float u_temperature;
      uniform float u_vignette;
      
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
      
      vec3 edgeDetect(sampler2D image, vec2 texCoord, vec2 resolution) {
        vec2 texelSize = 1.0 / resolution;
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
      
      vec3 blur(sampler2D image, vec2 texCoord, vec2 resolution) {
        vec2 texelSize = 1.0 / resolution;
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
      
      vec3 sharpen(sampler2D image, vec2 texCoord, vec2 resolution) {
        vec2 texelSize = 1.0 / resolution;
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
      
      // Helper: RGB to HSV conversion
      vec3 rgb2hsv(vec3 c) {
        vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
        vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
        vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
        float d = q.x - min(q.w, q.y);
        float e = 1.0e-10;
        return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
      }
      
      // Helper: HSV to RGB conversion
      vec3 hsv2rgb(vec3 c) {
        vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
        vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
        return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
      }
      
      // Pseudo-random function based on position
      float hash(vec2 p) {
        return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
      }
      
      // 2D noise function
      float noise(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        f = f * f * (3.0 - 2.0 * f); // smoothstep
        
        float a = hash(i);
        float b = hash(i + vec2(1.0, 0.0));
        float c = hash(i + vec2(0.0, 1.0));
        float d = hash(i + vec2(1.0, 1.0));
        
        return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
      }
      
      // Smooth blur for noise reduction
      vec3 smoothBlur(sampler2D image, vec2 texCoord, vec2 resolution) {
        vec2 texel = 1.0 / resolution;
        vec3 sum = vec3(0.0);
        float totalWeight = 0.0;
        
        // 5x5 Gaussian-like blur for smooth skin/surfaces
        for (int x = -2; x <= 2; x++) {
          for (int y = -2; y <= 2; y++) {
            vec2 offset = vec2(float(x), float(y)) * texel * 1.5;
            float weight = 1.0 / (1.0 + float(x*x + y*y));
            sum += texture2D(image, texCoord + offset).rgb * weight;
            totalWeight += weight;
          }
        }
        return sum / totalWeight;
      }
      
      // Sobel edge detection for cartoon outlines (with threshold)
      float sobelEdge(sampler2D image, vec2 texCoord, vec2 resolution) {
        vec2 texel = 1.0 / resolution * 2.0; // Larger sampling for smoother edges
        
        // Sample 3x3 neighborhood
        float tl = dot(texture2D(image, texCoord + vec2(-texel.x, texel.y)).rgb, vec3(0.299, 0.587, 0.114));
        float t  = dot(texture2D(image, texCoord + vec2(0.0, texel.y)).rgb, vec3(0.299, 0.587, 0.114));
        float tr = dot(texture2D(image, texCoord + vec2(texel.x, texel.y)).rgb, vec3(0.299, 0.587, 0.114));
        float l  = dot(texture2D(image, texCoord + vec2(-texel.x, 0.0)).rgb, vec3(0.299, 0.587, 0.114));
        float r  = dot(texture2D(image, texCoord + vec2(texel.x, 0.0)).rgb, vec3(0.299, 0.587, 0.114));
        float bl = dot(texture2D(image, texCoord + vec2(-texel.x, -texel.y)).rgb, vec3(0.299, 0.587, 0.114));
        float b  = dot(texture2D(image, texCoord + vec2(0.0, -texel.y)).rgb, vec3(0.299, 0.587, 0.114));
        float br = dot(texture2D(image, texCoord + vec2(texel.x, -texel.y)).rgb, vec3(0.299, 0.587, 0.114));
        
        // Sobel kernels
        float gx = -tl - 2.0*l - bl + tr + 2.0*r + br;
        float gy = -tl - 2.0*t - tr + bl + 2.0*b + br;
        
        return sqrt(gx*gx + gy*gy);
      }
      
      vec3 cyberpunk(sampler2D image, vec3 color, vec2 texCoord, vec2 resolution, float time) {
        // === SMOOTHING: Apply blur to reduce noise ===
        vec3 smoothed = smoothBlur(image, texCoord, resolution);
        
        // === SOFT POSTERIZATION ===
        float posterLevels = 4.0;
        vec3 posterized = floor(smoothed * posterLevels + 0.5) / posterLevels;
        posterized = mix(smoothed, posterized, 0.7);
        
        // === EDGE DETECTION: Only strong edges ===
        float edge = sobelEdge(image, texCoord, resolution);
        float edgeThreshold = 0.25;
        float edgeStrength = smoothstep(edgeThreshold, edgeThreshold + 0.15, edge);
        
        // === RANDOM VARIATION for position-based effects ===
        float rnd = hash(texCoord * 100.0);
        float noiseVal = noise(texCoord * 8.0);
        
        // === CYBERPUNK COLOR TRANSFORMATION ===
        vec3 hsv = rgb2hsv(posterized);
        
        // Boost saturation for vivid neon colors
        hsv.y = min(hsv.y * 1.8, 1.0);
        hsv.z = min(hsv.z * 1.1, 1.0);
        
        // Map hues to cyberpunk neon palette with MORE BLUE variation
        float hue = hsv.x * 360.0;
        
        // Random blue injection - some areas get pushed to blue
        float blueChance = noise(texCoord * 5.0 + 0.5);
        
        if (hue < 30.0 || hue >= 330.0) {
          // Reds -> Hot pink/magenta OR electric blue (random)
          hsv.x = blueChance > 0.6 ? 220.0 / 360.0 : 320.0 / 360.0;
        } else if (hue < 90.0) {
          // Orange/Yellow -> Neon pink OR cyan-blue
          hsv.x = blueChance > 0.5 ? 200.0 / 360.0 : 335.0 / 360.0;
        } else if (hue < 150.0) {
          // Yellow-green/Green -> Electric cyan OR deep blue
          hsv.x = blueChance > 0.4 ? 230.0 / 360.0 : 185.0 / 360.0;
        } else if (hue < 210.0) {
          // Cyan range -> Bright cyan OR neon blue
          hsv.x = blueChance > 0.3 ? 240.0 / 360.0 : 190.0 / 360.0;
        } else if (hue < 270.0) {
          // Blue range -> Deep neon blue (keep blue)
          hsv.x = mix(220.0, 250.0, noiseVal) / 360.0;
        } else {
          // Purple/Violet -> Electric purple OR blue-violet
          hsv.x = blueChance > 0.5 ? 260.0 / 360.0 : 290.0 / 360.0;
        }
        
        // Convert back to RGB
        vec3 neonColor = hsv2rgb(hsv);
        
        // === ADD RANDOM BLUE TINT OVERLAY ===
        float blueTint = noise(texCoord * 3.0) * 0.15;
        neonColor = mix(neonColor, vec3(0.2, 0.4, 1.0), blueTint);
        
        // === SOFT CONTRAST ===
        neonColor = (neonColor - 0.5) * 1.3 + 0.5;
        
        // === CARTOON OUTLINES ===
        vec3 edgeColor = vec3(0.05, 0.02, 0.18); // Slightly more blue in edges
        neonColor = mix(neonColor, edgeColor, edgeStrength * 0.85);
        
        // === ANIMATED NEON STREAKS / LIGHT FLARES ===
        // Flowing diagonal streaks that move over time
        float t = time * 0.8; // Animation speed
        
        // Streak 1: Flowing cyan diagonal lines
        float streak1Phase = texCoord.x * 12.0 + texCoord.y * 6.0 - t * 2.0;
        float streak1 = smoothstep(0.03, 0.0, abs(sin(streak1Phase) - 0.96));
        streak1 *= smoothstep(0.0, 0.3, sin(texCoord.y * 3.14159 + t)); // Fade in/out
        
        // Streak 2: Flowing pink opposite diagonal
        float streak2Phase = texCoord.x * 10.0 - texCoord.y * 8.0 + t * 1.5;
        float streak2 = smoothstep(0.025, 0.0, abs(sin(streak2Phase) - 0.97));
        streak2 *= smoothstep(0.0, 0.3, cos(texCoord.x * 3.14159 - t * 0.7));
        
        // Streak 3: Horizontal sweeping blue lines
        float streak3Phase = texCoord.y * 15.0 + t * 3.0;
        float streak3 = smoothstep(0.02, 0.0, abs(sin(streak3Phase) - 0.98));
        streak3 *= smoothstep(0.0, 0.4, sin(t * 0.5 + texCoord.x * 2.0));
        
        // Streak 4: Vertical sweeping magenta
        float streak4Phase = texCoord.x * 18.0 - t * 2.5;
        float streak4 = smoothstep(0.02, 0.0, abs(sin(streak4Phase) - 0.97));
        streak4 *= smoothstep(0.0, 0.3, cos(t * 0.3 + texCoord.y * 1.5));
        
        // Colorful animated streak colors
        vec3 streakColor1 = vec3(0.3, 0.9, 1.0) * streak1 * 0.5; // Cyan
        vec3 streakColor2 = vec3(1.0, 0.3, 0.8) * streak2 * 0.45; // Pink
        vec3 streakColor3 = vec3(0.4, 0.6, 1.0) * streak3 * 0.4; // Blue
        vec3 streakColor4 = vec3(0.9, 0.2, 0.9) * streak4 * 0.35; // Magenta
        
        neonColor += streakColor1 + streakColor2 + streakColor3 + streakColor4;
        
        // === ANIMATED LIGHT FLARES / BOKEH ===
        // Moving glowing spots
        for (int i = 0; i < 4; i++) {
          // Animate flare positions in circular/flowing patterns
          float fi = float(i);
          float angle = t * (0.3 + fi * 0.1) + fi * 1.57;
          float radius = 0.2 + 0.15 * sin(t * 0.5 + fi);
          vec2 flarePos = vec2(0.5) + vec2(cos(angle), sin(angle)) * radius;
          
          float flareDist = length(texCoord - flarePos);
          float flareIntensity = smoothstep(0.12, 0.0, flareDist) * 0.25;
          flareIntensity *= 0.5 + 0.5 * sin(t * 2.0 + fi * 1.5); // Pulsing
          
          // Cycle through colors
          vec3 flareColor;
          if (i == 0) flareColor = vec3(1.0, 0.2, 0.6); // Pink
          else if (i == 1) flareColor = vec3(0.2, 0.8, 1.0); // Cyan
          else if (i == 2) flareColor = vec3(0.4, 0.5, 1.0); // Blue
          else flareColor = vec3(0.8, 0.3, 1.0); // Purple
          
          neonColor += flareColor * flareIntensity;
        }
        
        // === SUBTLE GLOW ===
        float glowEdge = smoothstep(0.2, 0.35, edge);
        vec3 glowColor = mix(vec3(0.3, 0.5, 1.0), vec3(0.3, 1.0, 1.0), texCoord.y); // More blue in glow
        neonColor += glowColor * glowEdge * 0.15 * (1.0 - edgeStrength);
        
        // === VIGNETTE with blue tint ===
        vec2 position = texCoord - vec2(0.5);
        float dist = length(position);
        float vignette = smoothstep(1.0, 0.4, dist);
        vec3 vignetteColor = vec3(0.05, 0.02, 0.2); // More blue vignette
        neonColor = mix(vignetteColor, neonColor, vignette);
        
        // === BLOOM with blue bias ===
        float brightness = dot(neonColor, vec3(0.299, 0.587, 0.114));
        if (brightness > 0.6) {
          vec3 bloomColor = mix(vec3(0.5, 0.6, 1.0), vec3(0.5, 1.0, 1.0), texCoord.y);
          neonColor += bloomColor * (brightness - 0.6) * 0.25;
        }
        
        // === VERY SUBTLE SCANLINES ===
        float scanline = sin(texCoord.y * resolution.y * 0.8) * 0.015 + 1.0;
        neonColor *= scanline;
        
        return clamp(neonColor, 0.0, 1.0);
      }
      
      void main() {
        vec4 color = texture2D(u_image, v_texCoord);
        vec3 original = color.rgb;
        vec3 result = color.rgb;
        
        // Apply filter
        if (u_filter == 1) {
          result = grayscale(result);
        } else if (u_filter == 2) {
          result = sepia(result);
        } else if (u_filter == 3) {
          result = invert(result);
        } else if (u_filter == 4) {
          result = edgeDetect(u_image, v_texCoord, u_resolution);
        } else if (u_filter == 5) {
          result = cartoon(result);
        } else if (u_filter == 6) {
          result = blur(u_image, v_texCoord, u_resolution);
        } else if (u_filter == 7) {
          result = sharpen(u_image, v_texCoord, u_resolution);
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
        } else if (u_filter == 14) {
          result = cyberpunk(u_image, result, v_texCoord, u_resolution, u_time);
        }
        
        // Apply filter intensity (blend between original and filtered)
        result = mix(original, result, u_filterIntensity);
        
        // Apply photo adjustments
        // Brightness: -1 to 1, add to color
        result = result + vec3(u_brightness);
        
        // Contrast: -1 to 1, scale around 0.5
        result = (result - 0.5) * (1.0 + u_contrast) + 0.5;
        
        // Fade: 0 to 1, blend toward gray
        vec3 fadeColor = vec3(0.5);
        result = mix(result, fadeColor, u_fade);
        
        // Saturation: -1 to 1
        vec3 gray = vec3(dot(result, vec3(0.299, 0.587, 0.114)));
        result = mix(gray, result, 1.0 + u_saturation);
        
        // Temperature: -1 to 1, shift red/blue balance
        result.r = result.r + u_temperature * 0.1;
        result.b = result.b - u_temperature * 0.1;
        
        // Vignette: 0 to 1
        vec2 pos = v_texCoord - vec2(0.5);
        float dist = length(pos);
        float vignetteEffect = smoothstep(0.7, 0.3, dist);
        result = mix(result * (1.0 - u_vignette * 0.8), result, vignetteEffect);
        
        // Clamp final result
        result = clamp(result, 0.0, 1.0);
        
        gl_FragColor = vec4(result, color.a);
      }
    `;

    const vertexShader = this.createShader(this.gl, this.gl.VERTEX_SHADER, vertexShaderSource);
    const fragmentShader = this.createShader(this.gl, this.gl.FRAGMENT_SHADER, fragmentShaderSource);

    if (!vertexShader || !fragmentShader) {
      console.error('Failed to create shaders');
      return false;
    }

    const program = this.gl.createProgram();
    if (!program) {
      console.error('Failed to create WebGL program');
      return false;
    }

    this.program = program;
    this.gl.attachShader(this.program, vertexShader);
    this.gl.attachShader(this.program, fragmentShader);
    this.gl.linkProgram(this.program);

    if (!this.gl.getProgramParameter(this.program, this.gl.LINK_STATUS)) {
      console.error('Program link failed:', this.gl.getProgramInfoLog(this.program));
      return false;
    }

    return true;
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
      -1, 1,
      1, 1,
    ]);
    this.gl.bufferData(this.gl.ARRAY_BUFFER, positions, this.gl.STATIC_DRAW);

    // Texture coordinate buffer
    // Note: Y is flipped (1-y) because video origin is top-left, WebGL origin is bottom-left
    this.textureCoordBuffer = this.gl.createBuffer();
    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.textureCoordBuffer);
    const texCoords = new Float32Array([
      0, 1,  // bottom-left position -> top-left of video
      1, 1,  // bottom-right position -> top-right of video
      0, 0,  // top-left position -> bottom-left of video
      1, 0,  // top-right position -> bottom-right of video
    ]);
    this.gl.bufferData(this.gl.ARRAY_BUFFER, texCoords, this.gl.STATIC_DRAW);
  }

  private setupTexture(): void {
    if (!this.gl) return;

    this.texture = this.gl.createTexture();
    this.gl.bindTexture(this.gl.TEXTURE_2D, this.texture);

    // Set texture parameters for video (non-power-of-two textures)
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_S, this.gl.CLAMP_TO_EDGE);
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_T, this.gl.CLAMP_TO_EDGE);
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MIN_FILTER, this.gl.LINEAR);
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MAG_FILTER, this.gl.LINEAR);

    // Initialize with a placeholder pixel (helps prevent black texture issues)
    const pixel = new Uint8Array([128, 128, 128, 255]); // gray
    this.gl.texImage2D(this.gl.TEXTURE_2D, 0, this.gl.RGBA, 1, 1, 0, this.gl.RGBA, this.gl.UNSIGNED_BYTE, pixel);

    console.log('[VideoFilter] Texture setup complete');
  }

  private updateTextureCoords(left: number, right: number, top: number, bottom: number): void {
    if (!this.gl || !this.textureCoordBuffer) return;

    // Check if coords changed
    if (this.currentTexCoords.left === left &&
      this.currentTexCoords.right === right &&
      this.currentTexCoords.top === top &&
      this.currentTexCoords.bottom === bottom) {
      return;
    }

    this.currentTexCoords = { left, right, top, bottom };

    // Update texture coordinates
    // Note: Y is flipped because video origin is top-left, WebGL origin is bottom-left
    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.textureCoordBuffer);
    const texCoords = new Float32Array([
      left, 1 - top,      // bottom-left position -> top-left of video region
      right, 1 - top,     // bottom-right position -> top-right of video region
      left, 1 - bottom,   // top-left position -> bottom-left of video region
      right, 1 - bottom,  // top-right position -> bottom-right of video region
    ]);
    this.gl.bufferData(this.gl.ARRAY_BUFFER, texCoords, this.gl.DYNAMIC_DRAW);
  }

  setFilter(filterId: string): void {
    this.currentFilter = filterId;
  }

  getFilterIndex(filterId: string): number {
    return this.availableFilters.findIndex(f => f.id === filterId);
  }

  /**
   * Apply filter to an image and render to the canvas
   * @param image - The image element to apply the filter to
   */
  applyFilterToImage(image: HTMLImageElement): void {
    if (!this.gl || !this.program || !this.canvas) {
      return;
    }

    // Skip if image doesn't have valid dimensions yet
    if (image.naturalWidth === 0 || image.naturalHeight === 0) return;

    const filterIndex = this.getFilterIndex(this.currentFilter);
    const canvas = this.canvas;

    // Match image dimensions
    const targetWidth = image.naturalWidth;
    const targetHeight = image.naturalHeight;

    // Update canvas size if needed
    if (this.currentWidth !== targetWidth || this.currentHeight !== targetHeight) {
      this.currentWidth = targetWidth;
      this.currentHeight = targetHeight;
      canvas.width = targetWidth;
      canvas.height = targetHeight;
      // Update viewport after resize
      this.gl.viewport(0, 0, canvas.width, canvas.height);
    }

    // Reset texture coordinates for full image
    this.updateTextureCoords(0, 1, 0, 1);

    // Check if context was lost
    if (this.gl.isContextLost()) {
      console.error('[VideoFilter] WebGL context lost');
      return;
    }

    // Clear the canvas
    this.gl.clearColor(0, 0, 0, 1);
    this.gl.clear(this.gl.COLOR_BUFFER_BIT);

    // Activate texture unit 0 and upload image to texture
    this.gl.activeTexture(this.gl.TEXTURE0);
    this.gl.bindTexture(this.gl.TEXTURE_2D, this.texture);
    this.gl.texImage2D(this.gl.TEXTURE_2D, 0, this.gl.RGBA, this.gl.RGBA, this.gl.UNSIGNED_BYTE, image);

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
    const resolutionLocation = this.gl.getUniformLocation(this.program, 'u_resolution');
    const timeLocation = this.gl.getUniformLocation(this.program, 'u_time');
    const filterIntensityLocation = this.gl.getUniformLocation(this.program, 'u_filterIntensity');
    const brightnessLocation = this.gl.getUniformLocation(this.program, 'u_brightness');
    const contrastLocation = this.gl.getUniformLocation(this.program, 'u_contrast');
    const fadeLocation = this.gl.getUniformLocation(this.program, 'u_fade');
    const saturationLocation = this.gl.getUniformLocation(this.program, 'u_saturation');
    const temperatureLocation = this.gl.getUniformLocation(this.program, 'u_temperature');
    const vignetteLocation = this.gl.getUniformLocation(this.program, 'u_vignette');

    this.gl.uniform1i(imageLocation, 0);
    this.gl.uniform1i(filterLocation, filterIndex);
    this.gl.uniform2f(resolutionLocation, canvas.width, canvas.height);

    // Pass time for animated effects (in seconds)
    const currentTime = (performance.now() - this.startTime) / 1000.0;
    this.gl.uniform1f(timeLocation, currentTime);

    // Pass filter intensity and adjustments
    this.gl.uniform1f(filterIntensityLocation, this.filterIntensity);
    this.gl.uniform1f(brightnessLocation, this.adjustments.brightness / 100);
    this.gl.uniform1f(contrastLocation, this.adjustments.contrast / 100);
    this.gl.uniform1f(fadeLocation, this.adjustments.fade / 100);
    this.gl.uniform1f(saturationLocation, this.adjustments.saturation / 100);
    this.gl.uniform1f(temperatureLocation, this.adjustments.temperature / 100);
    this.gl.uniform1f(vignetteLocation, this.adjustments.vignette / 100);

    // Draw
    this.gl.drawArrays(this.gl.TRIANGLE_STRIP, 0, 4);
  }

  applyFilter(video: HTMLVideoElement, canvas: HTMLCanvasElement, targetAspectRatio?: number): void {
    if (!this.gl || !this.program) {
      return;
    }

    // Skip if video doesn't have valid dimensions yet
    if (video.videoWidth === 0 || video.videoHeight === 0) return;

    const filterIndex = this.getFilterIndex(this.currentFilter);

    // Calculate target canvas dimensions
    let targetWidth: number;
    let targetHeight: number;

    if (targetAspectRatio) {
      // Use target aspect ratio - scale to maintain reasonable resolution
      const baseSize = Math.max(video.videoWidth, video.videoHeight);
      if (targetAspectRatio > 1) {
        // Landscape
        targetWidth = baseSize;
        targetHeight = Math.round(baseSize / targetAspectRatio);
      } else {
        // Portrait
        targetHeight = baseSize;
        targetWidth = Math.round(baseSize * targetAspectRatio);
      }
    } else {
      // Match video dimensions
      targetWidth = video.videoWidth;
      targetHeight = video.videoHeight;
    }

    // Update canvas size if needed
    if (this.currentWidth !== targetWidth || this.currentHeight !== targetHeight) {
      this.currentWidth = targetWidth;
      this.currentHeight = targetHeight;
      canvas.width = targetWidth;
      canvas.height = targetHeight;
      // Update viewport after resize
      this.gl.viewport(0, 0, canvas.width, canvas.height);
      console.log(`[VideoFilter] Canvas resized to ${canvas.width}x${canvas.height}`);
    }

    // Calculate texture coordinates for center-crop (cover) effect
    const videoAspect = video.videoWidth / video.videoHeight;
    const canvasAspect = targetWidth / targetHeight;

    let texLeft = 0, texRight = 1, texTop = 0, texBottom = 1;

    if (targetAspectRatio && Math.abs(videoAspect - canvasAspect) > 0.01) {
      if (videoAspect > canvasAspect) {
        // Video is wider than target - crop left/right
        const scale = canvasAspect / videoAspect;
        const offset = (1 - scale) / 2;
        texLeft = offset;
        texRight = 1 - offset;
      } else {
        // Video is taller than target - crop top/bottom
        const scale = videoAspect / canvasAspect;
        const offset = (1 - scale) / 2;
        texTop = offset;
        texBottom = 1 - offset;
      }
    }

    // Update texture coordinates if they changed
    this.updateTextureCoords(texLeft, texRight, texTop, texBottom);

    // Check if context was lost
    if (this.gl.isContextLost()) {
      console.error('[VideoFilter] WebGL context lost');
      return;
    }

    // Clear the canvas
    this.gl.clearColor(0, 0, 0, 1);
    this.gl.clear(this.gl.COLOR_BUFFER_BIT);

    // Activate texture unit 0 and upload video frame to texture
    this.gl.activeTexture(this.gl.TEXTURE0);
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
    const resolutionLocation = this.gl.getUniformLocation(this.program, 'u_resolution');
    const timeLocation = this.gl.getUniformLocation(this.program, 'u_time');
    const filterIntensityLocation = this.gl.getUniformLocation(this.program, 'u_filterIntensity');
    const brightnessLocation = this.gl.getUniformLocation(this.program, 'u_brightness');
    const contrastLocation = this.gl.getUniformLocation(this.program, 'u_contrast');
    const fadeLocation = this.gl.getUniformLocation(this.program, 'u_fade');
    const saturationLocation = this.gl.getUniformLocation(this.program, 'u_saturation');
    const temperatureLocation = this.gl.getUniformLocation(this.program, 'u_temperature');
    const vignetteLocation = this.gl.getUniformLocation(this.program, 'u_vignette');

    this.gl.uniform1i(imageLocation, 0);
    this.gl.uniform1i(filterLocation, filterIndex);
    this.gl.uniform2f(resolutionLocation, canvas.width, canvas.height);

    // Pass time for animated effects (in seconds)
    const currentTime = (performance.now() - this.startTime) / 1000.0;
    this.gl.uniform1f(timeLocation, currentTime);

    // Pass filter intensity and adjustments
    this.gl.uniform1f(filterIntensityLocation, this.filterIntensity);
    this.gl.uniform1f(brightnessLocation, this.adjustments.brightness / 100);
    this.gl.uniform1f(contrastLocation, this.adjustments.contrast / 100);
    this.gl.uniform1f(fadeLocation, this.adjustments.fade / 100);
    this.gl.uniform1f(saturationLocation, this.adjustments.saturation / 100);
    this.gl.uniform1f(temperatureLocation, this.adjustments.temperature / 100);
    this.gl.uniform1f(vignetteLocation, this.adjustments.vignette / 100);

    // Draw
    this.gl.drawArrays(this.gl.TRIANGLE_STRIP, 0, 4);
  }

  cleanup(): void {
    this.cleanupWebGLResources();
    this.gl = null;
    this.canvas = null;
    this.currentWidth = 0;
    this.currentHeight = 0;
    this.currentTexCoords = { left: 0, right: 1, top: 0, bottom: 1 };
    this.startTime = performance.now();
  }
}
