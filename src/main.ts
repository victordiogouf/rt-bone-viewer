import { ACESFilmicToneMapping, AmbientLight, Clock, DirectionalLight, Material, Object3D, Raycaster, Scene, Vector2, WebGLRenderer } from 'three';

import KeyboardState from '../lib/keyboard-state';

import { OrbitalCamera } from './orbital-camera';
import { import_gltf } from './importer';

import skeleton_url from '../assets/skeleton.glb?url';
import { PinchHandler } from './pinch-handler';

let g_pinching = false;

main();

async function main() {
  const wglRenderer = new WebGLRenderer({ antialias: true });
  wglRenderer.setSize(window.innerWidth, window.innerHeight);
  wglRenderer.setClearColor(0x000000, 1);
  wglRenderer.toneMapping = ACESFilmicToneMapping;
  document.body.appendChild(wglRenderer.domElement);
  
  const camera = new OrbitalCamera(1.2, 50, window.innerWidth / window.innerHeight);
  
  const scene = new Scene();
  
  const light_1 = new DirectionalLight(0xffffff, 0.8);
  light_1.position.set(1, 1, 0);
  light_1.castShadow = true;
  scene.add(light_1);
  
  const light_2 = new DirectionalLight(0xffffff, 0.9);
  light_2.position.set(-1.5, -1, 0);
  light_2.castShadow = true;
  scene.add(light_2);
  
  const light_3 = new AmbientLight(0xffffff, 0.2);
  scene.add(light_3);
  
  const model = await import_gltf(skeleton_url);
  scene.add(model);
  
  const keyboard = new KeyboardState();
  
  wglRenderer.domElement.addEventListener('pointermove', e => process_pointer_move(e, scene, wglRenderer, camera));
  wglRenderer.domElement.addEventListener('pointerup', e => process_pointer_up(e));
  wglRenderer.domElement.addEventListener('mousewheel', e => process_mouse_wheel(e as WheelEvent, camera));
  wglRenderer.domElement.addEventListener('contextmenu', e => e.preventDefault());
  
  const pinch_handler = new PinchHandler(wglRenderer.domElement);
  pinch_handler.add_listener("pinchstart", () => g_pinching = true);
  pinch_handler.add_listener("pinchend", () => g_pinching = false);
  pinch_handler.add_listener("pinching", e => {
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
  });

  addEventListener('resize', () => {
    wglRenderer.setSize(window.innerWidth, window.innerHeight);
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
  });

  const clock = new Clock();
  clock.start();

  const render = () => {
    const frame_time = clock.getDelta();
    wglRenderer.render(scene, camera);
    process_keyboard(keyboard, camera, frame_time);
    requestAnimationFrame(render);
  }

  dispatchEvent(new CustomEvent('loaded', {}));
  render();
}

let g_intersection: { object: Object3D, material: Material } | null = null;

function process_pointer_move(event: PointerEvent, skeleton: Object3D, wglRenderer: WebGLRenderer, camera: OrbitalCamera) {
  if (g_pinching) return;

  if (g_intersection) {
    g_intersection.object.children.forEach(child => {
      (child as any).material.copy(g_intersection!.material);
    });
    g_intersection = null;
  }
  
  if (event.buttons === 1) {
    wglRenderer.domElement.style.cursor = 'grabbing';
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
    wglRenderer.domElement.style.cursor = 'grabbing';
    const { up, right } = camera.vectors;
    const offset = up.clone().multiplyScalar(event.movementY * 0.001).add(right.clone().multiplyScalar(-event.movementX * 0.001));
    camera.target.add(offset);
    camera.update_position();
    return;
  }
  else {
    wglRenderer.domElement.style.cursor = 'grab';
  }

  const mouse = new Vector2();
  mouse.x = (event.clientX / wglRenderer.domElement.clientWidth) * 2 - 1;
  mouse.y = -(event.clientY / wglRenderer.domElement.clientHeight) * 2 + 1;
  const raycaster = new Raycaster();
  raycaster.setFromCamera(mouse, camera);
  const intersects = raycaster.intersectObject(skeleton, true);
  if (intersects.length > 0) {
    wglRenderer.domElement.style.cursor = 'pointer';
    g_intersection = { 
      object: intersects[0].object.parent!, 
      material: (intersects[0].object as any).material.clone() 
    };
    g_intersection.object.children.forEach(child => {
      (child as any).material.emissive.setHex(0xffffff);
      (child as any).material.emissiveIntensity = 0.3;
    });
  }
}

function process_pointer_up(event: PointerEvent) {
  if (event.buttons === 1) {
    
  }
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
  }
  if (keyboard.pressed('S')) {
    camera.fov += 0.1 * frame_time;
    if (camera.fov > 179) {
      camera.fov = 179;
    }
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