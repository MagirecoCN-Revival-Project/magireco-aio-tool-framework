import { describe, expect, it } from 'vitest';
import type { BoneKeyframe, MovementBone, SpriteMovement } from '../src/armature.js';
import { IDENTITY, poseAt, poseOfBone } from '../src/pose.js';

const kf = (frame: number, over: Partial<Record<string, number>> = {}): BoneKeyframe => ({
  frame,
  x: 0,
  y: 0,
  scaleX: 1,
  scaleY: 1,
  skewX: 0,
  skewY: 0,
  displayIndex: 0,
  z: null,
  ...over,
});

const bone = (name: string, keyframes: BoneKeyframe[]): MovementBone => ({
  name,
  keyframes,
});

describe('poseOfBone', () => {
  it('没有关键帧的骨骼取单位变换——缩放是 1 不是 0', () => {
    // 0 会让骨骼直接消失，而「消失」看起来像资源没加载，能查很久。
    expect(poseOfBone(bone('b', []), 5)).toEqual(IDENTITY);
    expect(IDENTITY.scaleX).toBe(1);
  });

  it('落在关键帧上就取那一帧', () => {
    const b = bone('b', [kf(0, { x: 10 }), kf(10, { x: 30 })]);
    expect(poseOfBone(b, 0).x).toBe(10);
    expect(poseOfBone(b, 10).x).toBe(30);
  });

  it('两帧之间线性插值', () => {
    const b = bone('b', [kf(0, { x: 0, scaleX: 1 }), kf(10, { x: 100, scaleX: 3 })]);
    expect(poseOfBone(b, 5).x).toBeCloseTo(50);
    expect(poseOfBone(b, 5).scaleX).toBeCloseTo(2);
    expect(poseOfBone(b, 2).x).toBeCloseTo(20);
  });

  it('区间外夹住而不是外推——外推会让骨骼在首尾飞出画面', () => {
    const b = bone('b', [kf(5, { x: 10 }), kf(10, { x: 20 })]);
    expect(poseOfBone(b, 0).x).toBe(10);
    expect(poseOfBone(b, -99).x).toBe(10);
    expect(poseOfBone(b, 999).x).toBe(20);
  });

  it('只有一帧时处处取它', () => {
    const b = bone('b', [kf(3, { y: 7 })]);
    expect(poseOfBone(b, 0).y).toBe(7);
    expect(poseOfBone(b, 100).y).toBe(7);
  });

  it('帧号重复不做 0 除——NaN 变换在 canvas 上是「什么都不画」', () => {
    const b = bone('b', [kf(4, { x: 1 }), kf(4, { x: 9 })]);
    const p = poseOfBone(b, 4);
    expect(Number.isNaN(p.x)).toBe(false);
    expect(p.x).toBe(1);
  });

  it('多段轨道各取各的区间', () => {
    const b = bone('b', [kf(0, { x: 0 }), kf(10, { x: 10 }), kf(20, { x: 0 })]);
    expect(poseOfBone(b, 5).x).toBeCloseTo(5);
    expect(poseOfBone(b, 15).x).toBeCloseTo(5);
  });
});

describe('poseAt', () => {
  it('给出整个动作在某一帧的骨骼表', () => {
    const movement: SpriteMovement = {
      name: 'a',
      frames: 20,
      loop: false,
      speedScale: 1,
      tracks: [
        bone('head', [kf(0, { y: 0 }), kf(10, { y: 100 })]),
        bone('arm', [kf(0, { x: 0 }), kf(10, { x: -50 })]),
      ],
    };
    const pose = poseAt(movement, 5);
    expect([...pose.keys()]).toEqual(['head', 'arm']);
    expect(pose.get('head')?.y).toBeCloseTo(50);
    expect(pose.get('arm')?.x).toBeCloseTo(-25);
  });
});
