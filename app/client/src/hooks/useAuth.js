// web/src/hooks/useAuth.js
import { useAuthContext } from "../context/AuthStore";
export function useAuth() {
  return useAuthContext();
}
