import React, { useEffect, useState } from "react";
import { AbsoluteFill, continueRender, delayRender, IFrame } from "remotion";

const APP_ORIGIN = "http://localhost:3000";

export const ExactAppCapture: React.FC<{ route: string; waitMs?: number }> = ({
  route,
  waitMs = 12000,
}) => {
  const [handle] = useState(() => delayRender(`Waiting for AkibaMiles app route ${route}`));

  useEffect(() => {
    const timeout = setTimeout(() => continueRender(handle), waitMs);
    return () => clearTimeout(timeout);
  }, [handle, waitMs]);

  const src = `${APP_ORIGIN}${route}${route.includes("?") ? "&" : "?"}akibaPromoCapture=1`;

  return (
    <AbsoluteFill style={{ background: "#F7FEFF" }}>
      <IFrame
        src={src}
        title={`AkibaMiles capture ${route}`}
        style={{
          width: "100%",
          height: "100%",
          border: 0,
          display: "block",
          background: "#F7FEFF",
        }}
      />
    </AbsoluteFill>
  );
};
