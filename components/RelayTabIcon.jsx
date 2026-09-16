import Svg, { Path, Circle } from "react-native-svg";
const paths = {
  messages: "M4 5h16v11H9l-5 4V5Z",
  calls:
    "M7 3h3l2 5-2 2c1.5 3 3 4.5 6 6l2-2 5 2v3c0 2-2 3-4 3C10 21 3 14 3 5c0-2 2-2 4-2Z",
  relay: "M12 4v7M6 18v-3l6-4 6 4v3",
  settings:
    "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Zm0-5 2 2 3-1 1 3 3 1-1 3 1 3-3 1-1 3-3-1-3 1-1-3-3-1 1-3-1-3 3-1 1-3 3 1 2-2Z",
};
export default function RelayTabIcon({ name, color, size = 24 }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      {name === "relay" ? (
        <>
          <Circle cx="12" cy="4" r="2.2" fill={color} />
          <Circle cx="6" cy="19" r="2.2" fill={color} />
          <Circle cx="18" cy="19" r="2.2" fill={color} />
        </>
      ) : null}
      <Path
        d={paths[name]}
        fill="none"
        stroke={color}
        strokeWidth="1.8"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </Svg>
  );
}
