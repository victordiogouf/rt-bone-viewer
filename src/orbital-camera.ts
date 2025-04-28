import { PerspectiveCamera, Vector3 } from "three";

export class OrbitalCamera extends PerspectiveCamera {
  polar_angle: number;
  azimuthal_angle: number;
  distance: number;
  defocus_angle: number;
  target: Vector3;

  constructor(distance: number, vfov: number, aspect_ratio: number) {
    super(vfov, aspect_ratio, 0.1, 1000);
    this.polar_angle = 90;
    this.azimuthal_angle = 0;
    this.distance = distance;
    this.defocus_angle = 0;
    this.target = new Vector3(0, 0, 0);
    this.update_position();
  }

  lookAt(x: number | Vector3, y?: number, z?: number) {
    if (x instanceof Vector3) {
      super.lookAt(x);
      this.target.copy(x);
      this.update_position();
    }
    else if (typeof y === "number" && typeof z === "number") {
      this.lookAt(x, y, z);
      this.target.set(x, y, z);
      this.update_position();
    }
    else {
      throw new Error("Invalid arguments for lookAt method. Expected Vector3 or x, y, z coordinates.");
    }
  }

  update_position() {
    const polar_angle = this.polar_angle * Math.PI / 180;
    const azimuthal_angle = this.azimuthal_angle * Math.PI / 180;
    const x = this.distance * Math.sin(polar_angle) * Math.sin(azimuthal_angle);
    const y = this.distance * Math.cos(polar_angle);
    const z = this.distance * Math.sin(polar_angle) * Math.cos(azimuthal_angle);
    this.position.copy(new Vector3(x, y, z).add(this.target));
    super.lookAt(this.target);
  }
}