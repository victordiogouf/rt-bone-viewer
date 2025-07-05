import { FloatType, AmbientLight, Box3, Clock, DirectionalLight, Material, Object3D, Raycaster, Scene, Vector2, Vector3, WebGLRenderer, EquirectangularReflectionMapping, LinearFilter } from 'three';
import { RGBELoader } from 'three/examples/jsm/Addons.js';

import KeyboardState from '../lib/keyboard-state';

import { OrbitalCamera } from './orbital-camera';
import { import_gltf } from './importer';
import { PinchEvent, PinchHandler } from './pinch-handler';
import { normalize_scale, move_to_origin } from "./importer";

import studio_hall_url from '../assets/env/studio-hall.hdr?url';
import skeleton_url from '../assets/models/skeleton.glb?url';
import mirror_url from '../assets/models/ornate-mirror/ornate_mirror.gltf?url';
import table_url from '../assets/models/chinese-tea-table/chinese_tea_table.gltf?url';
import { RayTracingRenderer } from './rt-renderer/ray-tracing-renderer';

main();

async function load_hdr(path: string) {
  const loader = new RGBELoader().setDataType(FloatType);
  const env = await loader.loadAsync(path);
  env.mapping = EquirectangularReflectionMapping;
  env.needsUpdate = true;
  env.minFilter = LinearFilter;
  env.magFilter = LinearFilter;
  return env;
}

let g_detailed_view = false;

async function main() {
  const renderer = new RayTracingRenderer(window.innerWidth, window.innerHeight, 6);
  document.body.appendChild(renderer.domElement);
  document.body.appendChild(renderer.threejs_renderer.domElement);

  const camera = new OrbitalCamera(1.2, 50, window.innerWidth / window.innerHeight);

  const scene = new Scene();

  const env = await load_hdr(studio_hall_url);
  const selectable_scene_objects: Object3D[] = [];
  const rt_scene_objects: Object3D[] = [];

  // Selectable scene objects 
  const light_1 = new DirectionalLight(0xffffff, 0.9);
  light_1.position.set(1, 1, 0);
  light_1.castShadow = true;
  selectable_scene_objects.push(light_1);
  
  const light_2 = new DirectionalLight(0xffffff, 1.0);
  light_2.position.set(-1.5, -1, 0);
  light_2.castShadow = true;
  selectable_scene_objects.push(light_2);
  
  const light_3 = new AmbientLight(0xffffff, 0.5);
  selectable_scene_objects.push(light_3);
  
  const skeleton = await import_gltf(skeleton_url);
  selectable_scene_objects.push(skeleton);

  scene.add(...selectable_scene_objects);

  // Raytraced scene objects
  const mirror = await import_gltf(mirror_url);
  mirror.position.set(-0.3, 0.5, -0.3);
  mirror.scale.set(0.5, 0.5, 0.5);
  mirror.rotation.set(0, Math.PI / 4, 0);
  rt_scene_objects.push(mirror);
  
  const table = await import_gltf(table_url);
  rt_scene_objects.push(table);
  
  const keyboard = new KeyboardState();
  
  let pinching = false;
  const pinch_handler_1 = new PinchHandler(renderer.threejs_renderer.domElement);
  pinch_handler_1.add_listener("pinchstart", () => pinching = true);
  pinch_handler_1.add_listener("pinchend", () => pinching = false);
  pinch_handler_1.add_listener("pinching", e => handle_pinch(e, camera));

  const pinch_handler_2 = new PinchHandler(renderer.domElement);
  pinch_handler_2.add_listener("pinchstart", () => pinching = true);
  pinch_handler_2.add_listener("pinchend", () => pinching = false);
  pinch_handler_2.add_listener("pinching", e => handle_pinch(e, camera));

  renderer.threejs_renderer.domElement.addEventListener('pointermove', e => process_pointer_move(e, skeleton, renderer.threejs_renderer, camera, pinching));
  renderer.threejs_renderer.domElement.addEventListener('pointerup', e => process_pointer_up(e, skeleton, renderer.threejs_renderer, camera));
  renderer.threejs_renderer.domElement.addEventListener('mousewheel', e => process_mouse_wheel(e as WheelEvent, camera));
  renderer.threejs_renderer.domElement.addEventListener('contextmenu', e => e.preventDefault());

  renderer.domElement.addEventListener('pointermove', e => process_pointer_move(e, skeleton, renderer, camera, pinching));
  renderer.domElement.addEventListener('mousewheel', e => process_mouse_wheel(e as WheelEvent, camera));
  renderer.domElement.addEventListener('contextmenu', e => e.preventDefault());

  addEventListener('resize', () => {
    renderer.set_size(window.innerWidth, window.innerHeight);
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
  });

  addEventListener('detailed-view', () => {
    if (g_selected) {
      const selected_object = g_selected.object.clone();
      const box = new Box3().setFromObject(selected_object, true);
      const bottom = new Vector3(0, box.min.y - 0.33, 0);
      selected_object.position.sub(bottom);
      
      selected_object.children.forEach(child => {
        (child as any).material = g_selected!.material.clone();
      });
      scene.clear();
      scene.add(selected_object);
      scene.environment = env;
      scene.background = env;
      scene.add(...rt_scene_objects);
      g_detailed_view = true;
    }
  })

  addEventListener('quit-detailed-view', () => {
    scene.clear();
    scene.add(...selectable_scene_objects);
    scene.environment = null;
    scene.background = null;
    g_detailed_view = false;
  });

  addEventListener('start-rt', () => {
    renderer.rt = true;
  });

  addEventListener('stop-rt', () => {
    renderer.rt = false;
  });

  const clock = new Clock();
  clock.start();

  const render = () => {
    const frame_time = clock.getDelta();
    renderer.render(scene, camera);
    process_keyboard(keyboard, camera, frame_time);
    requestAnimationFrame(render);
  }

  dispatchEvent(new CustomEvent('loaded', {}));
  render();
}

let g_intersection: { object: Object3D, material: Material } | null = null;
let g_selected: { object: Object3D, material: Material } | null = null;

function selected_bones_transition(camera: OrbitalCamera, target: Object3D) {
  const box = new Box3().setFromObject(target);
  const center = box.getCenter(new Vector3());
  const size = box.getSize(new Vector3()).length();
  const desiredDistance = Math.max(0.6, size * 0.6);

  const startTarget = camera.target.clone();
  const startDistance = camera.distance;
  const endTarget = center;
  const endDistance = desiredDistance;

  let t = 0;
  const duration = 0.4; // seconds
  const clock = new Clock();

  function animate() {
    t += clock.getDelta() / duration;
    if (t > 1) t = 1;

    camera.target.lerpVectors(startTarget, endTarget, t);
    camera.distance = startDistance + (endDistance - startDistance) * t;
    camera.update_position();

    if (t < 1) {
      requestAnimationFrame(animate);
    }
  }

  clock.start();
  animate();
}

function process_pointer_move(event: PointerEvent, skeleton: Object3D, renderer: WebGLRenderer | RayTracingRenderer, camera: OrbitalCamera, pinching: boolean) {
  renderer.domElement.style.cursor = 'grab';
  if (pinching) return;
  
  if (event.buttons === 1) {
    renderer.domElement.style.cursor = 'grabbing';
    camera.azimuthal_angle -= event.movementX * 0.4;
    camera.polar_angle -= event.movementY * 0.4;
    if (camera.polar_angle < 0.01) {
      camera.polar_angle = 0.01;
    }
    if (camera.polar_angle > 179.99) {
      camera.polar_angle = 179.99;
    }
    camera.update_position();
    return;
  }
  else if (event.buttons === 2) {
    renderer.domElement.style.cursor = 'grabbing';
    const { up, right } = camera.vectors;
    const offset = up.clone().multiplyScalar(event.movementY * 0.001).add(right.clone().multiplyScalar(-event.movementX * 0.001));
    camera.target.add(offset);
    camera.update_position();
    return;
  }

  if (g_detailed_view) return;

  const size = new Vector2(renderer.domElement.width, renderer.domElement.height);
  const point = new Vector2(event.clientX, event.clientY);
  const intersection = get_intersection(point, size, camera, skeleton);
  if (intersection) {
    renderer.domElement.style.cursor = 'pointer';
    if (g_intersection?.object.uuid === intersection.object.parent!.uuid) return;

    if (g_intersection && g_intersection.object.uuid !== g_selected?.object.uuid) { // remove highlight from previous object
      g_intersection.object.children.forEach(child => {
        (child as any).material.copy(g_intersection!.material.clone());
      });
    }

    if (g_selected?.object.uuid === intersection.object.parent!.uuid) {
      g_intersection = g_selected;
    }
    else {
      g_intersection = { 
        object: intersection.object.parent!, 
        material: (intersection.object as any).material.clone() 
      };
      g_intersection.object.children.forEach(child => {
        (child as any).material.emissive.setHex(0xffffff);
        (child as any).material.emissiveIntensity = 0.3;
      });
    }
  }
  else if (g_intersection) {
    if (g_intersection.object.uuid !== g_selected?.object.uuid) { // remove highlight from previous object
      g_intersection.object.children.forEach(child => {
        (child as any).material.copy(g_intersection!.material.clone());
      });
    }
    g_intersection = null;
  }
}

function get_intersection(point: Vector2, size: Vector2, camera: OrbitalCamera, object: Object3D) {
  const pos = new Vector2();
  pos.x = (point.x / size.x) * 2 - 1;
  pos.y = -(point.y / size.y) * 2 + 1;
  const raycaster = new Raycaster();
  raycaster.setFromCamera(pos, camera);
  const intersects = raycaster.intersectObject(object, true);
  return intersects.length > 0 ? intersects[0] : null;
}

function process_pointer_up(event: PointerEvent, skeleton: Object3D, three_renderer: WebGLRenderer, camera: OrbitalCamera) {
  if (g_detailed_view) return;
  
  if (event.button !== 0) return;
  
  // deselect current object
  if (g_selected) {
    if (g_selected.object.uuid === g_intersection?.object.uuid) {
      g_selected = null;
      dispatchEvent(new CustomEvent('deselected', {}));
      return;
    }
    g_selected.object.children.forEach(child => {
      (child as any).material.copy(g_selected!.material.clone());
    });
    g_selected = null;
    dispatchEvent(new CustomEvent('deselected', {}));
  }

  if (!g_intersection) {
    const size = new Vector2(three_renderer.domElement.width, three_renderer.domElement.height);
    const point = new Vector2(event.clientX, event.clientY);
    const intersection = get_intersection(point, size, camera, skeleton);
    if (!intersection) return;
    g_selected = {
      object: intersection.object.parent!,
      material: (intersection.object as any).material.clone()
    };
    g_selected.object.children.forEach(child => {
      (child as any).material.emissive.setHex(0xffffff);
      (child as any).material.emissiveIntensity = 0.3;
    });
    dispatchEvent(new CustomEvent('selected', { detail: g_selected.object }));
    return;
  }

  g_selected = g_intersection;
  selected_bones_transition(camera, g_selected.object);
  dispatchEvent(new CustomEvent('selected', { detail: g_selected.object }));
}

function process_mouse_wheel(event: WheelEvent, camera: OrbitalCamera) {
  let offset = Math.exp(camera.distance * 0.1 - 0.5) * 0.001 * event.deltaY;
  if (Math.abs(offset) > 2) {
    offset = Math.sign(offset) * 2;
  }
  camera.distance += offset;
  if (camera.distance < 0.1) {
    camera.distance = 0.1;
  }
  if (camera.distance > 100) {
    camera.distance = 100;
  }
  camera.update_position();
}

function process_keyboard(keyboard: KeyboardState, camera: OrbitalCamera, frame_time: number) {
  if (keyboard.pressed('W')) {
    camera.fov -= 0.1 * frame_time;
    if (camera.fov < 1) {
      camera.fov = 1;
    }
    camera.updateProjectionMatrix();
  }
  if (keyboard.pressed('S')) {
    camera.fov += 0.1 * frame_time;
    if (camera.fov > 179) {
      camera.fov = 179;
    }
    camera.updateProjectionMatrix();
  }
  if (keyboard.pressed('A')) {
    camera.focus -= 0.002 * frame_time;
    if (camera.focus < 0.1) {
      camera.focus = 0.1;
    }
  }
  if (keyboard.pressed('Q')) {
    camera.focus += 0.002 * frame_time;
  }
  if (keyboard.pressed('D')) {
    camera.defocus_angle -= 0.002 * frame_time;
    if (camera.defocus_angle < 0) {
      camera.defocus_angle = 0;
    }
  }
  if (keyboard.pressed('E')) {
    camera.defocus_angle += 0.002 * frame_time;
    if (camera.defocus_angle > 45) {
      camera.defocus_angle = 45;
    }
  }

  keyboard.update();
}

function handle_pinch(e: PinchEvent, camera: OrbitalCamera) {
  const { up, right } = camera.vectors;
  const offset = up.clone().multiplyScalar(e.movement.y * camera.distance * 0.002)
    .add(right.clone().multiplyScalar(-e.movement.x * camera.distance * 0.002));
  camera.target.add(offset);

  camera.distance /= e.scale;
  if (camera.distance < 0.1) {
    camera.distance = 0.1;
  }
  if (camera.distance > 100) {
    camera.distance = 100;
  }
  camera.update_position();
}