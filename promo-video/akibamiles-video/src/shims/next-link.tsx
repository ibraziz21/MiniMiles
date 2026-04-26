// Shim for next/link — renders a plain <a> in Remotion context
import React from "react";

interface LinkProps {
  href: string;
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}

const NextLink: React.FC<LinkProps> = ({ href, children, className, style }) => {
  return (
    <a href={href} className={className} style={style}>
      {children}
    </a>
  );
};

export default NextLink;
