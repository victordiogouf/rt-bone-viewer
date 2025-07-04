export class TextureData {
  data: Float32Array;
  width: number;
  height: number;
  floats_per_pixel: number;

  constructor(length: number, pixels_per_element: number, floats_per_pixel: number, max_texture_size: number) {
    this.width = Math.min(max_texture_size, length * pixels_per_element);
    this.height = Math.ceil(length * pixels_per_element / this.width);
    this.data = new Float32Array(this.width * this.height * floats_per_pixel);
    this.floats_per_pixel = floats_per_pixel;
  }

  create_texture(gl: WebGL2RenderingContext) {
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);

    let internal_format: number;
    let format: number;
    
    switch (this.floats_per_pixel) {
      case 1:
        internal_format = gl.R32F;
        format = gl.RED;
        break;
      case 2:
        internal_format = gl.RG32F;
        format = gl.RG;
        break;
      case 3:
        internal_format = gl.RGB32F;
        format = gl.RGB;
        break
      case 4:
        internal_format = gl.RGBA32F;
        format = gl.RGBA;
        break;
      default:
        throw new Error("Invalid number of floats per pixel");
    }

    gl.texImage2D(gl.TEXTURE_2D, 0, internal_format, this.width, this.height, 0, format, gl.FLOAT, this.data);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    return texture;
  }
};