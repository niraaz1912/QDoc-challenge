import "./App.css";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import Login from "./pages/auth/Login";
import Register from "./pages/auth/Register";
import ProtectedRoute from "./components/auth/ProtectedRoute";
import AppLayout from "./components/AppLayout";
import { AuthProvider } from "./context/AuthContext";
import Profile from "./pages/profile/Profile";
import Dashboard from "./pages/dashboard/Dashboard";
import VaccinationHistory from "./pages/vaccination/VaccinationHistory";
import VaccineEligibility from "./components/VaccineEligibility";
import ClusterLive from "./pages/cluster/ClusterLive";
function ClinicHome() {
  return <div style={{ padding: 16 }}>Clinic Dashboard</div>;
}
function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />

          <Route
            element={
              <ProtectedRoute>
                <AppLayout />
              </ProtectedRoute>
            }
          >
            <Route
              path="/profile"
              element={<Profile />}
            />

            <Route
              path="/patient"
              element={<Navigate to="/profile" replace />}
            />

            <Route
              path="/dashboard"
              element={<Dashboard />}
            />

            <Route
              path="/vaccination-history"
              element={<VaccinationHistory />}
            />
            <Route
              path="/vaccination-eligibility"
              element={<VaccineEligibility />}
            />

            <Route
              path="/clinic"
              element={<ClinicHome />}
            />
            <Route path="/ops/cluster" element={<ClusterLive />} />
          </Route>

          <Route
            path="*"
            element={
              <Navigate to="/dashboard" replace />
            }
          />
        </Routes>
      </BrowserRouter>
    </AuthProvider>

  )
}

export default App
