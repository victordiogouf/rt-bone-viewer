export class SwapFramebuffer {
  current: number = 0;
  framebuffers: WebGLFramebuffer[];
  textures: WebGLTexture[];

  constructor(gl: WebGL2RenderingContext, width: number, height: number) {
    this.textures = [this.create_texture(gl, width, height), this.create_texture(gl, width, height)];
    this.framebuffers = [this.create_framebuffer(gl, this.textures[0]), this.create_framebuffer(gl, this.textures[1])];
  }
  
  get screen_texture() {
    return this.textures[this.current];
  }

  get offscreen_texture() {
    return this.textures[1 - this.current];
  }

  swap() {
    this.current = 1 - this.current;
  }

  use(gl: WebGL2RenderingContext) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffers[this.current]);
  }

  destroy(gl: WebGL2RenderingContext) {
    gl.deleteFramebuffer(this.framebuffers[0]);
    gl.deleteFramebuffer(this.framebuffers[1]);
    gl.deleteTexture(this.textures[0]);
    gl.deleteTexture(this.textures[1]);
  }  

  create_texture(gl: WebGL2RenderingContext, width: number, height: number): WebGLTexture {
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, width, height, 0, gl.RGBA, gl.FLOAT, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    return texture;
  }

  create_framebuffer(gl: WebGL2RenderingContext, texture: WebGLTexture) : WebGLFramebuffer {
    const framebuffer = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
  
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
      throw new Error('Framebuffer is incomplete');
    }
  
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  
    return framebuffer;
  }
};