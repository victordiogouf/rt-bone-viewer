import { OrbitalCamera } from "../orbital-camera";
import { create_shader_program } from "../shaders/shader-program";
import { SwapFramebuffer } from "./swap-framebuffer";

import screen_quad_vert_src from '../shaders/screen-quad.vert?raw';
import screen_quad_frag_src from '../shaders/screen-quad.frag?raw';
import ray_tracing_vert_src from '../shaders/ray-tracing.vert?raw';
import ray_tracing_frag_src from '../shaders/ray-tracing.frag?raw';
import { BufferAttribute, Material, Mesh, Scene, Texture, Vector2, Vector3, WebGLRenderer, ACESFilmicToneMapping } from "three";
import { Bvh } from "./bvh";
import { TextureData } from "./texture-data";

export class RayTracingRenderer {
  domElement: HTMLCanvasElement;
  framebuffer: SwapFramebuffer;
  ray_tracing_program: WebGLProgram | null = null;
  screen_quad_program: WebGLProgram | null = null;
  screen_quad_vao: WebGLVertexArrayObject;
  sample_count: number = 0;
  max_depth: number;
  rt: boolean = false;

  threejs_renderer: WebGLRenderer;

  constructor(width: number, height: number, max_depth: number) {
    this.domElement = document.createElement('canvas');
    this.domElement.width = width;
    this.domElement.height = height;
    this.domElement.style.display = 'none'; // hide canvas by default

    const gl = this.domElement.getContext('webgl2');
    if (!gl) {
      throw new Error('WebGL2 is not supported');
    }
    if (!gl.getExtension('EXT_color_buffer_float')) {
      throw new Error('EXT_color_buffer_float is not supported');
    }
    gl.viewport(0, 0, this.domElement.width, this.domElement.height);

    this.framebuffer = new SwapFramebuffer(gl, this.domElement.width, this.domElement.height);
    this.screen_quad_vao = create_screen_quad(gl);
    this.max_depth = max_depth;
    this.compile_shaders();

    this.threejs_renderer = new WebGLRenderer({ antialias: true });
    this.threejs_renderer.setSize(width, height);
    this.threejs_renderer.setClearColor(0x000000, 1);
    this.threejs_renderer.toneMapping = ACESFilmicToneMapping;
  }

  async compile_shaders() {
    const gl = this.domElement.getContext('webgl2')!;
    this.screen_quad_program = await create_shader_program(gl, screen_quad_vert_src, screen_quad_frag_src);
    this.ray_tracing_program = await create_shader_program(gl, ray_tracing_vert_src, ray_tracing_frag_src);
  }

  render(scene: Scene, camera: OrbitalCamera) {  
    if (!this.ray_tracing_program || !this.screen_quad_program) {
      return;
    }

    if (!this.rt && this.sample_count > 0) { // rt no more
      this.sample_count = 0;
      this.domElement.style.display = 'none';
      this.threejs_renderer.domElement.style.display = 'block';
    }

    if (!this.rt) {
      this.threejs_renderer.render(scene, camera);
      return;
    }

    if (this.sample_count === 0) { //rasterization no more
      this.domElement.style.display = 'block';
      this.threejs_renderer.domElement.style.display = 'none';
      const gl = this.domElement.getContext('webgl2')!;

      set_camera_uniforms(gl, this.ray_tracing_program, camera);
      set_environment_uniforms(gl, this.ray_tracing_program, scene);
      set_meshes_uniforms(gl, this.ray_tracing_program, scene);
    }

    ++this.sample_count;

    const gl = this.domElement.getContext('webgl2')!;
    
    // ray tracing rendering
    this.framebuffer.use(gl);
    gl.useProgram(this.ray_tracing_program);
    
    gl.uniform1i(gl.getUniformLocation(this.ray_tracing_program, 'u_prev_render'), 0);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.framebuffer.offscreen_texture);

    gl.uniform1i(gl.getUniformLocation(this.ray_tracing_program, 'u_sample_count'), this.sample_count);
    gl.uniform1i(gl.getUniformLocation(this.ray_tracing_program, 'u_max_depth'), this.max_depth);

    gl.bindVertexArray(this.screen_quad_vao);
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    // screen quad rendering
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.useProgram(this.screen_quad_program);

    gl.uniform1i(gl.getUniformLocation(this.screen_quad_program, 'u_render'), 0);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.framebuffer.screen_texture);

    gl.uniform1i(gl.getUniformLocation(this.screen_quad_program, 'u_sample_count'), this.sample_count);

    gl.bindVertexArray(this.screen_quad_vao);
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    this.framebuffer.swap();
  }

  set_size(width: number, height: number) {
    const gl = this.domElement.getContext('webgl2')!;
    gl.viewport(0, 0, width, height);
    this.domElement.width = width;
    this.domElement.height = height;
    this.framebuffer.destroy(gl);
    this.framebuffer = new SwapFramebuffer(gl, width, height);

    this.threejs_renderer.setSize(width, height);
  }
};

function create_screen_quad(gl: WebGL2RenderingContext): WebGLVertexArrayObject {
  const quad_verts = [-1, -1, 1, -1, 1, 1, -1, -1, 1, 1, -1, 1];
  const vao = gl.createVertexArray();
  const vbo = gl.createBuffer();
  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(quad_verts), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 2 * 4, 0);
  return vao;
}

function set_camera_uniforms(gl: WebGL2RenderingContext, program: WebGLProgram, camera: OrbitalCamera) {
  const { right, up, forward } = camera.vectors;

  const size = camera.getViewSize(camera.focus, new Vector2());
  const ray_step_x = right.clone().multiplyScalar(size.x / gl.canvas.width);
  const ray_step_y = up.clone().multiplyScalar(size.y / gl.canvas.height);
  const ray_position = camera.position.clone()
    .sub(right.clone().multiplyScalar(size.x * 0.5))
    .sub(up.clone().multiplyScalar(size.y * 0.5))
    .add(forward.clone().multiplyScalar(camera.focus))
    .add(ray_step_x.clone().multiplyScalar(0.5))
    .add(ray_step_y.clone().multiplyScalar(0.5));

  gl.useProgram(program);
  gl.uniform3fv(gl.getUniformLocation(program, 'u_right'), right.toArray());
  gl.uniform3fv(gl.getUniformLocation(program, 'u_up'), up.toArray());
  gl.uniform1f(gl.getUniformLocation(program, 'u_defocus_radius'), camera.defocus_radius);
  gl.uniform3fv(gl.getUniformLocation(program, 'u_initial_position'), ray_position.toArray());
  gl.uniform3fv(gl.getUniformLocation(program, 'u_step_x'), ray_step_x.toArray());
  gl.uniform3fv(gl.getUniformLocation(program, 'u_step_y'), ray_step_y.toArray());
  gl.uniform3fv(gl.getUniformLocation(program, 'u_look_from'), camera.position.toArray());
}

function set_environment_uniforms(gl: WebGL2RenderingContext, program: WebGLProgram, scene: Scene) {
  if (!scene.environment) {
    console.warn('No environment map found');
    return;
  }

  const env_texture = gl.createTexture();
  gl.useProgram(program);
  gl.uniform1i(gl.getUniformLocation(program, 'u_environment'), 1);
  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, env_texture);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, scene.environment.image.width, scene.environment.image.height, 0, gl.RGBA, gl.FLOAT, scene.environment.image.data);
  const param = gl.getExtension('OES_texture_float_linear') ? gl.LINEAR : gl.NEAREST;
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, param);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, param);

  gl.uniform1f(gl.getUniformLocation(program, 'u_environment_intensity'), scene.environmentIntensity);
}

let g_positions_texture: WebGLTexture | null = null;
let g_normals_texture: WebGLTexture | null = null;
let g_uvs_texture: WebGLTexture | null = null;
let g_tangents_texture: WebGLTexture | null = null;
let g_indices_texture: WebGLTexture | null = null;
let g_materials_texture: WebGLTexture | null = null;
let g_material_indices_texture: WebGLTexture | null = null;
let g_bvh_texture: WebGLTexture | null = null;
let g_texture_params_texture: WebGLTexture | null = null;
let g_textures_texture: WebGLTexture | null = null;

function set_meshes_uniforms(gl: WebGL2RenderingContext, program: WebGLProgram, scene: Scene) {
  gl.deleteTexture(g_positions_texture);
  gl.deleteTexture(g_normals_texture);
  gl.deleteTexture(g_uvs_texture);
  gl.deleteTexture(g_tangents_texture);
  gl.deleteTexture(g_indices_texture);
  gl.deleteTexture(g_materials_texture);
  gl.deleteTexture(g_material_indices_texture);
  gl.deleteTexture(g_bvh_texture);
  gl.deleteTexture(g_texture_params_texture);
  gl.deleteTexture(g_textures_texture);

  const positions: Vector3[] = [];
  const normals: Vector3[] = [];
  const uvs: Vector2[] = [];
  const tangents: Vector3[] = [];
  const indices: number[] = [];
  const materials: number[] = [];
  const material_indices: number[] = [];
  const textures: Texture[] = [];
  const texture_indices = new Map<string, number>();

  // Merging all meshes and extracting their attributes
  scene.traverse(obj => {
    obj.updateMatrixWorld();
    if (!(obj instanceof Mesh)) return;

    if (!obj.geometry.getAttribute('normal')) {
      obj.geometry.computeVertexNormals();
    }

    if (!obj.geometry.getIndex()) {
      obj.geometry.setIndex([...Array(obj.geometry.attributes.position.count).keys()]);
    }

    if (!obj.geometry.getAttribute('uv')) {
      obj.geometry.setAttribute('uv', new BufferAttribute(
        new Float32Array(obj.geometry.attributes.position.count * 2), 2
      ));
    }

    if (!obj.geometry.getAttribute('tangent')) {
      obj.geometry.computeTangents();
    }

    if (obj.material instanceof Array && obj.material.length == 0) {
      obj.material.push(new Material());
    }

    const mesh_materials = obj.material instanceof Array ? obj.material : [obj.material];

    mesh_materials.forEach(m => {
      const indices = {
        albedo: -1,
        normal: -1,
        roughness: -1,
        metalness: -1,
        emission: -1,
        opacity: -1,
        transmission: -1,
      }

      if (m.map) {
        if (!texture_indices.has(m.map.uuid)) {
          texture_indices.set(m.map.uuid, textures.length);
          textures.push(m.map);
        }
        indices.albedo = texture_indices.get(m.map.uuid)!;
      }

      if (m.normalMap) {
        if (!texture_indices.has(m.normalMap.uuid)) {
          texture_indices.set(m.normalMap.uuid, textures.length);
          textures.push(m.normalMap);
        }
        indices.normal = texture_indices.get(m.normalMap.uuid)!;
      }

      if (m.roughnessMap) {
        if (!texture_indices.has(m.roughnessMap.uuid)) {
          texture_indices.set(m.roughnessMap.uuid, textures.length);
          textures.push(m.roughnessMap);
        }
        indices.roughness = texture_indices.get(m.roughnessMap.uuid)!;
      }

      if (m.metalnessMap) {
        if (!texture_indices.has(m.metalnessMap.uuid)) {
          texture_indices.set(m.metalnessMap.uuid, textures.length);
          textures.push(m.metalnessMap);
        }
        indices.metalness = texture_indices.get(m.metalnessMap.uuid)!;
      }

      if (m.emissiveMap) {
        if (!texture_indices.has(m.emissiveMap.uuid)) {
          texture_indices.set(m.emissiveMap.uuid, textures.length);
          textures.push(m.emissiveMap);
        }
        indices.emission = texture_indices.get(m.emissiveMap.uuid)!;
      }

      if (m.alphaMap) {
        if (!texture_indices.has(m.alphaMap.uuid)) {
          texture_indices.set(m.alphaMap.uuid, textures.length);
          textures.push(m.alphaMap);
        }
        indices.opacity = texture_indices.get(m.alphaMap.uuid)!;
      }

      if (m.transmissionMap) {
        if (!texture_indices.has(m.transmissionMap.uuid)) {
          texture_indices.set(m.transmissionMap.uuid, textures.length);
          textures.push(m.transmissionMap);
        }
        indices.transmission = texture_indices.get(m.transmissionMap.uuid)!;
      }

      const albedo = m.color ? m.color.toArray() : [1, 1, 1];
      const emission_intensity = m.emissiveIntensity ? m.emissiveIntensity : 0;
      const emission = m.emissive ? m.emissive.toArray().map((c: number) => c * emission_intensity) : [0, 0, 0];
      const metalness = m.metalness ? m.metalness : 0;
      const roughness = m.roughness !== undefined ? m.roughness : 1;
      const transmission = m.transmission !== undefined ? m.transmission : 0;

      materials.push(
        indices.albedo,
        indices.roughness,
        indices.metalness,
        indices.normal,
        indices.emission,
        indices.opacity,
        indices.transmission,
        m.opacity,
        ...albedo,
        transmission,
        ...emission,
        m.ior || 1,
        roughness,
        metalness,
        0, 0
      )
    });

    const geometry = obj.geometry.clone().applyMatrix4(obj.matrixWorld);
    const index = geometry.getIndex()!;
    const position = geometry.getAttribute('position');

    if (geometry.groups.length === 0) {
      geometry.addGroup(0, index.count, 0);
    }

    for (let group = 0; group < geometry.groups.length; ++group) {
      const start = geometry.groups[group].start;
      const count = geometry.groups[group].count;
      
      const material_index = (materials.length / 20) - geometry.groups.length + (geometry.groups[group].materialIndex || group);

      for (let i = start; i < start + count; ++i) {
        if (i % 3 === 0) {
          material_indices.push(material_index);
        }

        const idx = index.getX(i);
        indices.push(idx + positions.length);
      }
    }

    for (let i = 0; i < position.count; ++i) {
      positions.push(new Vector3().fromBufferAttribute(position, i));
    }

    const normal = geometry.getAttribute('normal');

    for (let i = 0; i < normal.count; ++i) {
      normals.push(new Vector3().fromBufferAttribute(normal, i));
    }

    const uv = geometry.getAttribute('uv');

    for (let i = 0; i < uv.count; ++i) {
      uvs.push(new Vector2().fromBufferAttribute(uv, i));
    }

    const tangent = geometry.getAttribute('tangent');

    for (let i = 0; i < tangent.count; ++i) {
      tangents.push(new Vector3().fromBufferAttribute(tangent, i));
    }
  })

  // create bvh from attributes
  const bvh = new Bvh(
    new Float32Array(positions.flatMap(p => [p.x, p.y, p.z])),
    new Float32Array(indices),
    indices.length
  );

  // set uniforms
  gl.useProgram(program);
  gl.uniform1i(gl.getUniformLocation(program, "u_max_texture_size"), gl.MAX_TEXTURE_SIZE);
  gl.uniform1i(gl.getUniformLocation(program, "u_bvh_length"), bvh.list.length);

  // position buffer
  const position_data = new TextureData(
    positions.length,
    1,
    3,
    gl.MAX_TEXTURE_SIZE
  );
  position_data.data.set(new Float32Array(positions.flatMap(p => [p.x, p.y, p.z])), 0);
  gl.uniform1i(gl.getUniformLocation(program, "u_positions"), 2);
  gl.activeTexture(gl.TEXTURE2);
  g_positions_texture = position_data.create_texture(gl);

  // normal buffer
  const normal_data = new TextureData(
    normals.length,
    1,
    3,
    gl.MAX_TEXTURE_SIZE
  );
  normal_data.data.set(new Float32Array(normals.flatMap(n => [n.x, n.y, n.z])), 0);
  gl.uniform1i(gl.getUniformLocation(program, "u_normals"), 3);
  gl.activeTexture(gl.TEXTURE3);
  g_normals_texture = normal_data.create_texture(gl);

  // uv buffer
  const uv_data = new TextureData(
    uvs.length,
    1,
    2,
    gl.MAX_TEXTURE_SIZE
  );
  uv_data.data.set(new Float32Array(uvs.flatMap(u => [u.x, u.y])), 0);
  gl.uniform1i(gl.getUniformLocation(program, "u_uvs"), 4);
  gl.activeTexture(gl.TEXTURE4);
  g_uvs_texture = uv_data.create_texture(gl);

  // tangent buffer
  const tangent_data = new TextureData(
    tangents.length,
    1,
    3,
    gl.MAX_TEXTURE_SIZE
  );
  tangent_data.data.set(new Float32Array(tangents.flatMap(t => [t.x, t.y, t.z])), 0);
  gl.uniform1i(gl.getUniformLocation(program, "u_tangents"), 5);
  gl.activeTexture(gl.TEXTURE5);
  g_tangents_texture = tangent_data.create_texture(gl);

  // indices buffer
  const indices_data = new TextureData(
    indices.length,
    1,
    1,
    gl.MAX_TEXTURE_SIZE
  );
  indices_data.data.set(new Float32Array(indices), 0);
  gl.uniform1i(gl.getUniformLocation(program, "u_indices"), 6);
  gl.activeTexture(gl.TEXTURE6);
  g_indices_texture = indices_data.create_texture(gl);

  // materials buffer 
  const materials_data = new TextureData(
    materials.length / 20,
    5,
    4,
    gl.MAX_TEXTURE_SIZE
  );
  materials_data.data.set(new Float32Array(materials), 0);
  gl.uniform1i(gl.getUniformLocation(program, "u_materials"), 7);
  gl.activeTexture(gl.TEXTURE7);
  g_materials_texture = materials_data.create_texture(gl);

  // material indices buffer
  const material_indices_data = new TextureData(
    material_indices.length,
    1,
    1,
    gl.MAX_TEXTURE_SIZE
  );
  material_indices_data.data.set(new Float32Array(material_indices), 0);
  gl.uniform1i(gl.getUniformLocation(program, "u_material_indices"), 8);
  gl.activeTexture(gl.TEXTURE8);
  g_material_indices_texture = material_indices_data.create_texture(gl);

  // bvh buffer
  const bvh_data = new TextureData(
    bvh.list.length,
    2,
    4,
    gl.MAX_TEXTURE_SIZE
  );
  bvh_data.data.set(new Float32Array(bvh.list.flatMap(b => [b.left_index, b.parent_index, ...b.aabb.to_array()])), 0);
  gl.uniform1i(gl.getUniformLocation(program, "u_bvh"), 9);
  gl.activeTexture(gl.TEXTURE9);
  g_bvh_texture = bvh_data.create_texture(gl);

  // texture params buffer
  const texture_params_data = new TextureData(
    textures.length,
    2,
    4,
    gl.MAX_TEXTURE_SIZE
  );

  gl.uniform1i(gl.getUniformLocation(program, "u_textures"), 10);
  gl.activeTexture(gl.TEXTURE10);

  if (textures.length > 0) {
    let max_width = 0;
    let max_height = 0;
    
    textures.forEach(t => {
      if (t.image.width > max_width) max_width = t.image.width;
      if (t.image.height > max_height) max_height = t.image.height;
    });

    g_textures_texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, g_textures_texture);
    gl.texStorage3D(gl.TEXTURE_2D_ARRAY, 1, gl.RGBA8, max_width, max_height, textures.length);

    textures.forEach((t, i) => {
      texture_params_data.data.set([
        t.image.width / max_width,
        t.image.height / max_height,
        t.flipY ? 1 : 0,
        t.rotation,
        t.repeat.x, 
        t.repeat.y,
        t.offset.x,
        t.offset.y
      ], i * 8);

      gl.texSubImage3D(
        gl.TEXTURE_2D_ARRAY,
        0,
        0, 
        0,
        i,
        t.image.width, 
        t.image.height, 
        1,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        t.image
      );
    });
  }
  else {
    g_textures_texture = null;
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, null);
  }

  gl.uniform1i(gl.getUniformLocation(program, "u_texture_params"), 11);
  gl.activeTexture(gl.TEXTURE11);
  g_texture_params_texture = texture_params_data.create_texture(gl);
}