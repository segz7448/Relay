import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { AppState } from "react-native";
import { api } from "./api";
const C = createContext(null);
export function CallProvider({ children }) {
  const [activeCall, setActiveCall] = useState(null),
    [loaded, setLoaded] = useState(false),
    timer = useRef();
  const refresh = useCallback(async () => {
    try {
      setActiveCall(await api.getActiveCall());
    } finally {
      setLoaded(true);
    }
  }, []);
  useEffect(() => {
    refresh();
    timer.current = setInterval(refresh, 2500);
    const s = AppState.addEventListener(
      "change",
      (x) => x === "active" && refresh(),
    );
    return () => {
      clearInterval(timer.current);
      s.remove();
    };
  }, [refresh]);
  const value = useMemo(
    () => ({ activeCall, setActiveCall, refresh, loaded }),
    [activeCall, refresh, loaded],
  );
  return <C.Provider value={value}>{children}</C.Provider>;
}
export function useCall() {
  return useContext(C);
}
