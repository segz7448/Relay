import Svg, { Circle, Path, Rect } from "react-native-svg";
export default function AgentConsoleIcon({
  name,
  size = 22,
  color = "#FF8A3D",
}) {
  const p = {
    fill: "none",
    stroke: color,
    strokeWidth: 1.9,
    strokeLinecap: "round",
    strokeLinejoin: "round",
  };
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      accessibilityElementsHidden
    >
      {name === "relay" ? (
        <>
          <Path d="M12 4v7m0 0-6 6m6-6 6 6" {...p} />
          <Circle cx="12" cy="4" r="2" fill={color} />
          <Circle cx="6" cy="18" r="2" fill={color} />
          <Circle cx="18" cy="18" r="2" fill={color} />
        </>
      ) : null}
      {name === "key" ? (
        <>
          <Circle cx="8" cy="11" r="4" {...p} />
          <Path d="M12 11h9m-3 0v3m-3-3v2" {...p} />
        </>
      ) : null}
      {name === "copy" ? (
        <>
          <Rect x="5" y="4" width="11" height="13" rx="2" {...p} />
          <Rect x="9" y="8" width="10" height="12" rx="2" {...p} />
        </>
      ) : null}
      {name === "rotate" ? (
        <>
          <Path d="M20 7v5h-5M4 17v-5h5" {...p} />
          <Path
            d="M6.1 8a7 7 0 0 1 11.4-1.6L20 12M4 12l2.5 5.6A7 7 0 0 0 18 16"
            {...p}
          />
        </>
      ) : null}
      {name === "audit" ? (
        <>
          <Path d="M8 6h12M8 12h12M8 18h8" {...p} />
          <Circle cx="4" cy="6" r="1" fill={color} />
          <Circle cx="4" cy="12" r="1" fill={color} />
          <Circle cx="4" cy="18" r="1" fill={color} />
        </>
      ) : null}
      {name === "trash" ? (
        <>
          <Path d="M4 7h16M9 7V4h6v3m3 0-1 13H7L6 7m4 4v5m4-5v5" {...p} />
        </>
      ) : null}
      {name === "shield" ? (
        <Path
          d="M12 3 20 6v5c0 5-3.4 8.3-8 10-4.6-1.7-8-5-8-10V6l8-3Zm-3 9 2 2 4-5"
          {...p}
        />
      ) : null}
      {name === "back" ? <Path d="m14 5-7 7 7 7M7 12h13" {...p} /> : null}
      {name === "retry" ? (
        <Path d="M20 5v6h-6m4.3 6A8 8 0 1 1 20 11" {...p} />
      ) : null}
    </Svg>
  );
}
