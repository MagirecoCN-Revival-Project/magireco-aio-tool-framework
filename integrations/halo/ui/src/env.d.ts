/// <reference types="@rsbuild/core/types" />

// side-effect 形式的 CSS import 需要一份声明，否则 vue-tsc 找不到模块。
declare module '*.css';
