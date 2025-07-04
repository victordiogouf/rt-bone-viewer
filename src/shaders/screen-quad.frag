#version 300 es

precision highp int;
precision highp float;
precision highp sampler2D;

uniform sampler2D u_render;
uniform int u_sample_count;

out vec4 o_color;

vec3 gamma_correct(vec3 color) {
  return pow(color, vec3(1.0 / 2.2));
}

vec3 aces_tonemap(vec3 x) {
  const float a = 2.51;
  const float b = 0.03;
  const float c = 2.43;
  const float d = 0.59;
  const float e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}

void main() {
  vec3 color = texelFetch(u_render, ivec2(gl_FragCoord.xy), 0).rgb / float(u_sample_count);
  color = aces_tonemap(color);
  color = gamma_correct(color);
  o_color = vec4(color, 1.0);
}