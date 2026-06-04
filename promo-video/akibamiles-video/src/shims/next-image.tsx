// Shim for next/image — renders a plain <img> in Remotion context
import React from "react";
import { Img, staticFile } from "remotion";

interface ImageProps {
  src: string | { src: string };
  width?: number;
  height?: number;
  alt?: string;
  className?: string;
  style?: React.CSSProperties;
}

const NextImage: React.FC<ImageProps> = ({ src, width, height, alt = "", className, style }) => {
  const resolvedSrc = typeof src === "object" && "src" in src ? src.src : src as string;
  const remotionSrc = resolvedSrc.startsWith("/") ? staticFile(resolvedSrc.replace(/^\//, "")) : resolvedSrc;
  return (
    <Img
      src={remotionSrc}
      width={width}
      height={height}
      alt={alt}
      className={className}
      style={style}
    />
  );
};

export default NextImage;
