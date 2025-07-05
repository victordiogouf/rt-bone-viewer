import { Vector3 } from "three";

class Aabb {
  min: Vector3;
  max: Vector3;

  constructor(min: Vector3, max: Vector3) {
    this.min = min;
    this.max = max;
    this.pad_to_minimuns();
  }

  longest_axis() {
    const x = this.max.x - this.min.x;
    const y = this.max.y - this.min.y;
    const z = this.max.z - this.min.z;
    if (x > y && x > z) {
      return 0;
    }
    if (y > z) {
      return 1;
    }
    return 2;
  }

  to_array() {
    return [
      this.min.x, this.min.y, this.min.z,
      this.max.x, this.max.y, this.max.z
    ];
  }

  pad_to_minimuns() {
    if (this.max.x - this.min.x < 2e-5) {
      this.min.x -= 1e-5;
      this.max.x += 1e-5;
    }
    if (this.max.y - this.min.y < 2e-5) {
      this.min.y -= 1e-5;
      this.max.y += 1e-5;
    }
    if (this.max.z - this.min.z < 2e-5) {
      this.min.z -= 1e-5;
      this.max.z += 1e-5;
    }
  }

  static from_triangle(a: Vector3, b: Vector3, c: Vector3) {
    const min = new Vector3(
      Math.min(a.x, b.x, c.x),
      Math.min(a.y, b.y, c.y),
      Math.min(a.z, b.z, c.z)
    );
    const max = new Vector3(
      Math.max(a.x, b.x, c.x),
      Math.max(a.y, b.y, c.y),
      Math.max(a.z, b.z, c.z)
    );
    return new Aabb(min, max);
  }


  static merge(a: Aabb, b: Aabb) {
    return new Aabb(
      new Vector3(Math.min(a.min.x, b.min.x), Math.min(a.min.y, b.min.y), Math.min(a.min.z, b.min.z)),
      new Vector3(Math.max(a.max.x, b.max.x), Math.max(a.max.y, b.max.y), Math.max(a.max.z, b.max.z))
    );
  }
}

class BvhNode {
  left_index: number; // negative if leaf
  parent_index: number;
  aabb: Aabb;

  constructor(left_index: number, parent_index: number, aabb: Aabb) {
    this.left_index = left_index;
    this.parent_index = parent_index;
    this.aabb = aabb;
  }
};

type Triangles = { triangle_index: number, aabb: Aabb }[];

export class Bvh {
  list: BvhNode[] = [];

  constructor(positions: Float32Array, indices: Float32Array, num_indices: number) {
    const triangles: Triangles = [];
    for (let i = 0; i < num_indices; i += 3) {
      const ai = indices[i + 0];
      const bi = indices[i + 1];
      const ci = indices[i + 2];
      const a = new Vector3(positions[ai * 3 + 0], positions[ai * 3 + 1], positions[ai * 3 + 2]);
      const b = new Vector3(positions[bi * 3 + 0], positions[bi * 3 + 1], positions[bi * 3 + 2]);
      const c = new Vector3(positions[ci * 3 + 0], positions[ci * 3 + 1], positions[ci * 3 + 2]);
      triangles.push({ triangle_index: i / 3, aabb: Aabb.from_triangle(a, b, c) });
    }
    const {left_index, aabb} = this.build(triangles);
    this.list.push(new BvhNode(left_index, -1, aabb));
  }

  build(triangles: Triangles): { left_index: number, aabb: Aabb } {
    const span = triangles.length;
    
    if (span == 1) {
      const tri = triangles[0];
      const node = new BvhNode(-tri.triangle_index - 1, this.list.length + 2, tri.aabb);
      this.list.push(node); // left
      this.list.push(node); // right
      return {left_index: this.list.length - 2, aabb: tri.aabb};
    }
    else if (span == 2) {
      const left_tri = triangles[0];
      const left = new BvhNode(-left_tri.triangle_index - 1, this.list.length + 2, left_tri.aabb);
      const right_tri = triangles[1];
      const right = new BvhNode(-right_tri.triangle_index - 1, this.list.length + 2, right_tri.aabb);
      this.list.push(left);
      this.list.push(right);
      return {left_index: this.list.length - 2, aabb: Aabb.merge(left_tri.aabb, right_tri.aabb)};
    }

    let bounding_box = triangles[0].aabb;
    for (let i = 1; i < span; ++i) {
      bounding_box = Aabb.merge(bounding_box, triangles[i].aabb);
    }

    const axis = bounding_box.longest_axis();
    triangles.sort((a, b) => {
      return a.aabb.min.getComponent(axis) - b.aabb.min.getComponent(axis);
    });

    const mid = Math.ceil(span / 2);

    const left_data = this.build(triangles.slice(0, mid));
    const left = new BvhNode(left_data.left_index, -1, left_data.aabb);
    this.list.push(left);
    const left_index = this.list.length - 1;

    const right_data = this.build(triangles.slice(mid));
    const right = new BvhNode(right_data.left_index, this.list.length + 1, right_data.aabb);
    left.parent_index = this.list.length + 1;
    this.list.push(right);

    return { left_index, aabb: Aabb.merge(left_data.aabb, right_data.aabb)};
  }
};