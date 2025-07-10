import { Box3, Mesh, Object3D, Vector3, LinearFilter, EquirectangularReflectionMapping, FloatType, TextureLoader } from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { RGBELoader } from 'three/examples/jsm/Addons.js';

export async function import_gltf(url: string) {
  if (!url.endsWith('.gltf') && !url.endsWith('.glb'))
    throw new Error("Invalid GLTF file. Please provide a .gltf or .glb file.");
  
  const loader = new GLTFLoader();
  const gltf = await loader.loadAsync(url);
  gltf.scene.traverse(child => {
    if (child instanceof Mesh) {
      child.castShadow = true;
      child.receiveShadow = true;
      child.material = child.material.clone();
    }
  });
  normalize_scale(gltf.scene);
  move_to_origin(gltf.scene);
  gltf.scene.updateMatrixWorld(true);
  return gltf.scene;
}

export function normalize_scale(object: Object3D) {
  const box = new Box3().setFromObject(object, true);
  const size = box.getSize(new Vector3());
  const max = Math.max(size.x, size.y, size.z);
  object.scale.setScalar(1 / max);
}

export function move_to_origin(object: Object3D) {
  const box = new Box3().setFromObject(object, true);
  const center = box.getCenter(new Vector3());
  object.position.sub(center);
}

async function load_env_hdr(path: string) {
  const loader = new RGBELoader().setDataType(FloatType);
  const env = await loader.loadAsync(path);
  env.mapping = EquirectangularReflectionMapping;
  env.minFilter = LinearFilter;
  env.magFilter = LinearFilter;
  env.needsUpdate = true;
  return env;
}

async function load_env_texture(path: string) {
  const loader = new TextureLoader();
  const texture = await loader.loadAsync(path);
  texture.mapping = EquirectangularReflectionMapping;
  texture.minFilter = LinearFilter;
  texture.magFilter = LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

export async function import_env(url: string) {
  if (!url.endsWith('.hdr') && !url.endsWith('.jpg') && !url.endsWith('.png'))
    throw new Error("Invalid environment file. Please provide a .hdr, .jpg, or .png file.");
  
  if (url.endsWith('.hdr')) {
    return await load_env_hdr(url);
  } else {
    return await load_env_texture(url);
  }
}