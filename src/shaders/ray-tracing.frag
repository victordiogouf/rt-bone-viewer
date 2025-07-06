#version 300 es

precision highp int;
precision highp float;
precision highp sampler2D;
precision highp sampler2DArray;

// renderer
uniform sampler2D u_environment;
uniform sampler2D u_prev_render;
uniform float u_environment_intensity;
uniform int u_sample_count;
uniform int u_max_depth;
// scene
uniform sampler2D u_positions;
uniform sampler2D u_normals;
uniform sampler2D u_uvs;
uniform sampler2D u_tangents;
uniform sampler2D u_indices;
uniform sampler2D u_materials;
uniform sampler2D u_material_indices;
uniform sampler2D u_bvh;
uniform sampler2D u_texture_params;
uniform sampler2DArray u_textures;
uniform int u_bvh_length;
uniform int u_max_texture_size;
// camera
uniform float u_defocus_radius;
uniform vec3 u_initial_position;
uniform vec3 u_step_x;
uniform vec3 u_step_y;
uniform vec3 u_right;
uniform vec3 u_up;
uniform vec3 u_look_from;

out vec4 o_color;

const float g_max_float = 3.402823466e+38;
const float g_pi = 3.1415926535897932385;

// --> RANDOM NUMBER GENERATOR
uint g_rng_state;

uint jenkins_hash(uint x) {
  x += x << 10u;
  x ^= x >> 6u;
  x += x << 3u;
  x ^= x >> 11u;
  x += x << 15u;
  return x;
}

void init_rng() {
  uint seed = (uint(gl_FragCoord.x) + uint(gl_FragCoord.y) * uint(textureSize(u_prev_render, 0).x)) ^ jenkins_hash(uint(u_sample_count));
  g_rng_state = jenkins_hash(seed);
}

uint xorshift() {
  g_rng_state ^= g_rng_state << 13u;
  g_rng_state ^= g_rng_state >> 17u;
  g_rng_state ^= g_rng_state << 5u;
  return g_rng_state;
}

float uint_to_float(uint x) {
  return uintBitsToFloat(0x3f800000u | (x >> 9u)) - 1.0;
}

// returns a random float in the range [0, 1)
float rand() {
  return uint_to_float(xorshift());
}

vec3 random_unit_vector() {
  float z = 1.0 - 2.0 * rand();
  float a = 2.0 * g_pi * rand();
  float r = sqrt(1.0 - z * z);
  return vec3(r * cos(a), r * sin(a), z);
}

vec3 random_cosine_direction() {
  float r1 = rand();
  float r2 = rand();

  float phi = 2.0 * g_pi * r1;
  float x = cos(phi) * sqrt(r2);
  float y = sin(phi) * sqrt(r2);
  float z = sqrt(1.0 - r2);

  return vec3(x, y, z);
}

struct Ray {
  vec3 origin;
  vec3 direction;
};

vec3 ray_at(Ray ray, float t) {
  return ray.origin + t * ray.direction;
}

struct HitRecord {
  float t;
  float p;
  float q;
  ivec3 indices;
  int triangle_index;
};

ivec2 to_texture_coords(int index) {
  int i = index % u_max_texture_size;
  int j = index / u_max_texture_size;
  return ivec2(i, j);
}

struct TextureParams {
  vec2 scale;
  int flip_y;
  float rotation;
  vec2 repeat;
  vec2 offset;
};

TextureParams get_texture_params(int index) {
  ivec2 coords = to_texture_coords(index * 2 + 0);
  vec4 data_a = texelFetch(u_texture_params, coords, 0).xyzw;
  coords = to_texture_coords(index * 2 + 1);
  vec4 data_b = texelFetch(u_texture_params, coords, 0).xyzw;
  return TextureParams(data_a.xy, int(data_a.z), data_a.w, data_b.xy, data_b.zw);
}

vec4 texture_lookup(int index, vec2 uv) {
  TextureParams params = get_texture_params(index);
  uv = fract(uv * params.repeat + params.offset);
  uv *= params.scale;
  
  if (params.flip_y == 1) {
    uv.y = 1.0 - uv.y;
  }

  float c = cos(params.rotation);
  float s = sin(params.rotation);
  uv = vec2(uv.x * c - uv.y * s, uv.x * s + uv.y * c);

  return texture(u_textures, vec3(uv, index));
}

int get_attribute_index(int triangle_index, int vertex_index) {
  ivec2 coords = to_texture_coords(triangle_index * 3 + vertex_index);
  return int(texelFetch(u_indices, coords, 0).r);
}

vec3 get_position(int index) {
  ivec2 coords = to_texture_coords(index);
  return texelFetch(u_positions, coords, 0).xyz;
}

vec2 get_uv(int index) {
  ivec2 coords = to_texture_coords(index);
  return texelFetch(u_uvs, coords, 0).xy;
}

vec3 get_normal(int index) {
  ivec2 coords = to_texture_coords(index);
  return texelFetch(u_normals, coords, 0).xyz;
}

vec3 get_tangent(int index) {
  ivec2 coords = to_texture_coords(index);
  return texelFetch(u_tangents, coords, 0).xyz;
}

bool hit_triangle(int triangle_index, Ray ray, float min_distance, float max_distance, out HitRecord hit_record) {
  // o + td = a + p * ab + q * ac

  int a_index = get_attribute_index(triangle_index, 0);
  int b_index = get_attribute_index(triangle_index, 1);
  int c_index = get_attribute_index(triangle_index, 2);
  
  vec3 a = get_position(a_index);
  vec3 b = get_position(b_index);
  vec3 c = get_position(c_index);

  vec3 ab = b - a;
  vec3 ac = c - a;

  vec3 abxac = cross(ab, ac);
  float det = dot(abxac, -ray.direction);
  if (abs(det) < 1e-8) {
    return false;
  }

  float inv_det = 1.0 / det;

  vec3 ao = ray.origin - a;

  vec3 dxao = cross(ray.direction, ao);
  float p = dot(-dxao, ac) * inv_det;
  if (p < 0.0 || p > 1.0) {
    return false;
  }

  float q = dot(dxao, ab) * inv_det;
  if (q < 0.0 || p + q > 1.0) {
    return false;
  }

  float t = dot(abxac, ao) * inv_det;
  if (t < min_distance || t > max_distance) {
    return false;
  }

  hit_record.t = t;
  hit_record.p = p;
  hit_record.q = q;
  hit_record.indices = ivec3(a_index, b_index, c_index);
  hit_record.triangle_index = triangle_index;

  return true;
}

struct BvhNode {
  int left_index;
  int parent_index;
  vec3 box_min;
  vec3 box_max;
};

BvhNode get_bvh_node(int index) {
  ivec2 coords = to_texture_coords(index * 2 + 0);
  vec4 data_a = texelFetch(u_bvh, coords, 0).xyzw;
  coords = to_texture_coords(index * 2 + 1);
  vec4 data_b = texelFetch(u_bvh, coords, 0).xyzw;
  return BvhNode(int(data_a.x), int(data_a.y), vec3(data_a.zw, data_b.x), vec3(data_b.yzw));
}

bool hit_bounding_box(BvhNode node, Ray ray, float min_distance, float max_distance) {
  vec3 inv_dir = 1.0 / ray.direction;
  vec3 t0 = (node.box_min - ray.origin) * inv_dir;
  vec3 t1 = (node.box_max - ray.origin) * inv_dir;

  vec3 tmin = min(t0, t1);
  vec3 tmax = max(t0, t1);

  float t_enter = max(max(tmin.x, tmin.y), tmin.z);
  float t_exit = min(min(tmax.x, tmax.y), tmax.z);

  return t_exit > t_enter && t_exit > min_distance && t_enter < max_distance;
}

bool trace(Ray ray, out HitRecord hit_record) {
  int current = u_bvh_length - 1;
  int prev = -1;

  hit_record.t = g_max_float;

  HitRecord temp_record;

  while (current != -1) {
    BvhNode node = get_bvh_node(current);

    if (prev == node.parent_index) {  
      if (!hit_bounding_box(node, ray, 0.0, hit_record.t)) {
        prev = current;
        current = node.parent_index;
        continue;
      }

      if (node.left_index < 0) {
        if (hit_triangle(-node.left_index - 1, ray, 0.0, hit_record.t, temp_record)) {
          hit_record = temp_record;
        }
        prev = current;
        current = node.parent_index;
      }
      else {
        prev = current;
        current = node.left_index;
      }
    }
    else if (prev == node.left_index) {
      prev = current;
      current = current - 1;
    }
    else { // prev == node.right_index
      prev = current;
      current = node.parent_index;
    }
  }

  return hit_record.t < g_max_float;
}

struct ScatterData {
  vec3 attenuation;
  Ray scattered;
};

struct Material {
  int albedo_index; 
  int roughness_index;
  int metalness_index;
  int normal_index;
  int emission_index;
  int opacity_index;
  int transmission_index;
  float opacity;
  vec3 albedo;
  float transmission;
  vec3 emission;
  float refraction_index;
  float roughness;
  float metalness;
};

Material get_material(int triangle_index) {
  ivec2 coords = to_texture_coords(triangle_index);
  int material_index = int(texelFetch(u_material_indices, coords, 0).x);
  coords = to_texture_coords(material_index * 5 + 0);
  vec4 data_a = texelFetch(u_materials, coords, 0).xyzw;
  coords = to_texture_coords(material_index * 5 + 1);
  vec4 data_b = texelFetch(u_materials, coords, 0).xyzw;
  coords = to_texture_coords(material_index * 5 + 2);
  vec4 data_c = texelFetch(u_materials, coords, 0).xyzw;
  coords = to_texture_coords(material_index * 5 + 3);
  vec4 data_d = texelFetch(u_materials, coords, 0).xyzw;
  coords = to_texture_coords(material_index * 5 + 4);
  vec4 data_e = texelFetch(u_materials, coords, 0).xyzw;
  return Material(
    int(data_a.x), 
    int(data_a.y),
    int(data_a.z),
    int(data_a.w),
    int(data_b.x),
    int(data_b.y),
    int(data_b.z),
    data_b.w,
    data_c.xyz,
    data_c.w,
    data_d.xyz,
    data_d.w,
    data_e.x,
    data_e.y
  );
}

struct SurfaceData {
  vec3 point;
  vec3 normal;
  vec2 uv;
  bool front_face;
  Material material;
};

bool near_zero(vec3 v, float epsilon) {
  return (abs(v.x) < epsilon) && (abs(v.y) < epsilon) && (abs(v.z) < epsilon);
}

const float g_scatter_bias = 5e-5;

vec3 sample_ggx_vndf(vec3 Ve, float alpha) {
  float U1 = rand();
  float U2 = rand();

  vec3 Vh = normalize(vec3(Ve.x * alpha, Ve.y * alpha, Ve.z));

  vec3 T1 = (Vh.z < 0.99999) ? normalize(cross(vec3(0.0, 0.0, 1.0), Vh)) : vec3(1.0, 0.0, 0.0);
  vec3 T2 = cross(Vh, T1);

  float r = sqrt(U1);
  float phi = 2.0 * g_pi * U2;
  float t1 = r * cos(phi);
  float t2 = r * sin(phi);
  float s = 0.5 * (1.0 + Vh.z);
  t2 = (1.0 - s) * sqrt(1.0 - t1 * t1) + s * t2;

  vec3 Nh = T1 * t1 + T2 * t2 + Vh * sqrt(max(0.0, 1.0 - t1 * t1 - t2 * t2));

  return normalize(vec3(Nh.xy * alpha, max(0.0, Nh.z)));
}

float A(vec3 V, float alpha) {
  float a2 = alpha * alpha;
  return (-1.0 + sqrt(1.0 + a2 * (V.x * V.x + V.y * V.y) / (V.z * V.z))) * 0.5;
}

float G1(vec3 V, float alpha) {
  return 1.0 / (1.0 + A(V, alpha));
}

float G2(vec3 V1, vec3 V2, float alpha) {
  return 1.0 / (1.0 + A(V1, alpha) + A(V2, alpha));
}

vec3 F(float cos_theta, vec3 F0) {
  return F0 + (1.0 - F0) * pow(clamp(1.0 - cos_theta, 0.0, 1.0), 5.0);
}

ScatterData scatter_physical(Ray ray, SurfaceData surface_data) {
  vec3 tangent = (abs(surface_data.normal.z) < 0.99999) ? normalize(cross(vec3(0.0, 0.0, 1.0), surface_data.normal)) : vec3(1.0, 0.0, 0.0);
  vec3 bitangent = cross(surface_data.normal, tangent);
  mat3 basis = mat3(tangent, bitangent, surface_data.normal);
  mat3 inv_basis = transpose(basis);

  vec3 Ve = inv_basis * -ray.direction;
  float alpha = surface_data.material.roughness * surface_data.material.roughness;
  vec3 h = sample_ggx_vndf(Ve, alpha);

  vec3 F0 = vec3(0.04);
  F0 = mix(F0, surface_data.material.albedo, surface_data.material.metalness);

  vec3 ks = F(max(dot(Ve, h), 0.0), F0);
  vec3 kd = vec3(1.0) - ks;
  kd *= 1.0 - surface_data.material.metalness;

  vec3 Li;
  vec3 attenuation;

  float pdiffuse = dot(kd, vec3(0.299, 0.587, 0.114));
  if (rand() < pdiffuse) {
    Li = random_cosine_direction();
    attenuation = kd * surface_data.material.albedo;
    attenuation /= pdiffuse;
  }
  else {
    Li = reflect(-Ve, h); 
    attenuation = ks * G2(Ve, Li, alpha) / G1(Ve, alpha);
    attenuation /= (1.0 - pdiffuse);
  }

  return ScatterData(attenuation, Ray(surface_data.point + surface_data.normal * g_scatter_bias, basis * Li));
}

float reflectance(float cosine, float ri) {
  float r0 = (1.0 - ri) / (1.0 + ri);
  r0 = r0 * r0;
  return r0 + (1.0 - r0) * pow(1.0 - cosine, 5.0);
}

ScatterData scatter_dielectric(Ray ray, SurfaceData surface_data) {
  float refraction_index = surface_data.front_face ? 1.0 / surface_data.material.refraction_index : surface_data.material.refraction_index;

  float cos_theta = min(dot(-ray.direction, surface_data.normal), 1.0);  
  float sin_theta = sqrt(1.0 - cos_theta * cos_theta);

  bool cannot_refract = refraction_index * sin_theta > 1.0;
  vec3 direction;
  vec3 point;

  if (cannot_refract || reflectance(cos_theta, refraction_index) > rand()) {
    direction = reflect(ray.direction, surface_data.normal);
    point = surface_data.point + surface_data.normal * g_scatter_bias;
  }
  else {
    direction = refract(ray.direction, surface_data.normal, refraction_index);
    point = surface_data.point - surface_data.normal * g_scatter_bias;
  }

  return ScatterData(vec3(1.0), Ray(point, direction));
}

SurfaceData get_surface_data(Ray ray, HitRecord hit_record) {
  SurfaceData data;

  vec2 a_uv = get_uv(hit_record.indices.x);
  vec2 b_uv = get_uv(hit_record.indices.y);
  vec2 c_uv = get_uv(hit_record.indices.z);

  vec3 a_normal = get_normal(hit_record.indices.x);
  vec3 b_normal = get_normal(hit_record.indices.y);
  vec3 c_normal = get_normal(hit_record.indices.z);

  float r = 1.0 - hit_record.p - hit_record.q;

  data.point = ray_at(ray, hit_record.t);
  data.normal = normalize(r * a_normal + hit_record.p * b_normal + hit_record.q * c_normal);
  data.front_face = dot(ray.direction, data.normal) < 0.0;
  if (!data.front_face) {
    data.normal = -data.normal;
  }
  data.uv = r * a_uv + hit_record.p * b_uv + hit_record.q * c_uv;
  data.material = get_material(hit_record.triangle_index);

  if (data.material.albedo_index != -1) {
    vec4 tex = texture_lookup(data.material.albedo_index, data.uv);
    data.material.albedo *= tex.rgb;
    data.material.opacity *= tex.a;
  }

  if (data.material.roughness_index != -1) {
    data.material.roughness *= texture_lookup(data.material.roughness_index, data.uv).g;
  }

  if (data.material.metalness_index != -1) {
    data.material.metalness *= texture_lookup(data.material.metalness_index, data.uv).b;
  }

  if (data.material.normal_index != -1) {
    vec3 a_tangent = get_tangent(hit_record.indices.x);
    vec3 b_tangent = get_tangent(hit_record.indices.y);
    vec3 c_tangent = get_tangent(hit_record.indices.z);
    vec3 tangent = r * a_tangent + hit_record.p * b_tangent + hit_record.q * c_tangent;
    if (!near_zero(tangent, 1e-4)) {
      tangent = normalize(tangent);
      vec3 bitangent = cross(data.normal, tangent);
      mat3 tbn = mat3(tangent, bitangent, data.normal);
      vec3 tex = texture_lookup(data.material.normal_index, data.uv).rgb;
      data.normal = normalize(tbn * (2.0 * tex - 1.0));
    }
  }

  if (data.material.emission_index != -1) {
    data.material.emission *= texture_lookup(data.material.emission_index, data.uv).rgb;
  }

  if (data.material.opacity_index != -1) {
    data.material.opacity *= texture_lookup(data.material.opacity_index, data.uv).r;
  }

  if (data.material.transmission_index != -1) {
    data.material.transmission *= texture_lookup(data.material.transmission_index, data.uv).r;
  }

  if (data.material.roughness < 0.0001) {
    data.material.roughness = 0.0001;
  }

  return data;
}

vec3 texture_environment(vec3 direction) {
  vec2 uv = vec2(0.5 - atan(-direction.z, direction.x) / (2.0 * g_pi), 0.5 - asin(clamp(direction.y, -1.0, 1.0)) / g_pi);
  return texture(u_environment, uv).xyz * u_environment_intensity;
}

vec3 cast_ray(Ray ray) {
  vec3 color = vec3(1.0);

  for (int depth = 0; depth <= u_max_depth; ++depth) {
    if (depth == u_max_depth) {
      return vec3(0.0);
    }

    if (near_zero(color, 1e-3)) {
      return color;
    }

    HitRecord hit_record;

    if (!trace(ray, hit_record)) {
      color *= texture_environment(ray.direction);
      break;
    }

    SurfaceData surface_data = get_surface_data(ray, hit_record);
    // color = surface_data.material.opacity * vec3(1.0);
    // color = surface_data.material.transmission * vec3(1.0);
    // color = surface_data.normal * 0.5 + 0.5;
    // color = surface_data.material.albedo;
    // color = surface_data.material.emission;
    // color = surface_data.material.roughness * vec3(1.0);
    // color = surface_data.material.metalness * vec3(1.0);
    // break;

    if (!near_zero(surface_data.material.emission, 1e-3)) {
      color *= surface_data.material.emission * 3.0;
      break;
    }

    if (rand() > surface_data.material.opacity) {
      ray.origin = surface_data.point - surface_data.normal * g_scatter_bias;
      continue;
    }

    ScatterData scatter_data;
    if (rand() < surface_data.material.transmission) {
      scatter_data = scatter_dielectric(ray, surface_data);
    }
    else {
      scatter_data = scatter_physical(ray, surface_data);
    }

    color *= scatter_data.attenuation;
    ray = scatter_data.scattered;
  }

  return color;
}

Ray generate_ray() {
  float r = sqrt(rand());
  float theta = 2.0 * g_pi * rand();
  vec3 radial_offset = u_defocus_radius * r * (cos(theta) * u_right + sin(theta) * u_up);

  vec3 pos_offset = (rand() - 0.5) * u_step_x + (rand() - 0.5) * u_step_y;

  vec3 position = u_initial_position + gl_FragCoord.x * u_step_x + gl_FragCoord.y * u_step_y;
  vec3 origin = u_look_from + radial_offset;
  vec3 direction = normalize(position + pos_offset - origin);

  return Ray(origin, direction);
}

void main() {
  init_rng();

  Ray ray = generate_ray();
  vec3 color = cast_ray(ray);

  if (u_sample_count == 1) {
    o_color = vec4(0.0);
  }
  else {
    o_color = texelFetch(u_prev_render, ivec2(gl_FragCoord.xy), 0);
  }

  o_color += vec4(color, 1.0);
}