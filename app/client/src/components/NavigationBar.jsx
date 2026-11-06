import React from "react";
import { Sidebar } from "react-pro-sidebar";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { CgProfile, CgHome } from "react-icons/cg";
import { FaHistory, FaTimes, FaSignOutAlt, FaNetworkWired } from "react-icons/fa";
import { TbVaccineBottle } from "react-icons/tb";
import { useAuth } from "../hooks/useAuth"; // <-- adjust if needed

function NavigationBar({ isOpen, onClose, sidebarWidth = 260 }) {
  const location = useLocation();
  const navigate = useNavigate();
  const { logout, user } = useAuth(); // if your hook uses a different name, adjust here
  const [clusterViewer, setClusterViewer] = React.useState(false);

  React.useEffect(() => {
    let live = true;
    user?.getIdTokenResult().then((result) => {
      if (live) setClusterViewer(result.claims.clusterViewer === true);
    }).catch(() => { if (live) setClusterViewer(false); });
    return () => { live = false; };
  }, [user]);

  if (!isOpen) return null;

  const navItems = [
    { to: "/dashboard", label: "Dashboard", icon: <CgHome /> },
    { to: "/vaccination-history", label: "Vaccination History", icon: <FaHistory /> },
    { to: "/profile", label: "Update Profile", icon: <CgProfile /> },
    { to: "/vaccination-eligibility", label: "Vaccination Eligibility", icon: <TbVaccineBottle /> },
    ...(clusterViewer ? [{ to: "/ops/cluster", label: "Live Cluster", icon: <FaNetworkWired /> }] : []),
  ];

  async function handleSignOut() {
    try {
      await logout();
      onClose?.();
      navigate("/login");
    } catch (err) {
      console.error("Logout failed:", err);
    }
  }

  return (
    <>
      {/* Backdrop */}
      <div style={styles.backdrop} onClick={onClose} aria-hidden="true" />

      <Sidebar
        width={`${sidebarWidth}px`}
        rootStyles={{
          position: "fixed",
          top: 0,
          left: 0,
          height: "100vh",
          zIndex: 40,
          borderRight: "1px solid rgba(15,23,42,0.08)",
          background: "rgba(255,255,255,0.96)",
          boxShadow: "0 14px 40px rgba(2,6,23,0.10)",
          display: "flex",
          flexDirection: "column",
          [".ps-sidebar-container"]: {
            background: "rgba(255,255,255,0.96)",
            display: "flex",
            flexDirection: "column",
            height: "100%",
          },
        }}
      >
        {/* Header */}
        <div style={styles.header}>
          <div style={styles.brandRow}>
            <div style={styles.logo}>U</div>
            <div>
              <div style={styles.brandTitle}>Navigation</div>
              <div style={styles.brandSub}>Patient Portal</div>
            </div>
          </div>

          <button
            onClick={onClose}
            style={styles.closeBtn}
            aria-label="Close navigation"
            title="Close navigation"
            type="button"
          >
            <span style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
              <FaTimes />
            </span>
          </button>
        </div>

        {/* Nav links */}
        <div style={styles.navList}>
          {navItems.map((item) => {
            const active = location.pathname === item.to;

            return (
              <Link
                key={item.to}
                to={item.to}
                onClick={onClose}
                style={{
                  ...styles.navItem,
                  ...(active ? styles.navItemActive : {}),
                }}
              >
                <span
                  style={{
                    ...styles.navIcon,
                    ...(active ? styles.navIconActive : {}),
                  }}
                >
                  {item.icon}
                </span>
                <span>{item.label}</span>
              </Link>
            );
          })}
        </div>

        {/* Footer Sign Out */}
        <div style={styles.footer}>
          <button
            type="button"
            onClick={handleSignOut}
            style={styles.signOutBtn}
            aria-label="Sign out"
            title="Sign out"
          >
            <span style={styles.signOutIcon}>
              <FaSignOutAlt />
            </span>
            <span>Sign out</span>
          </button>
        </div>
      </Sidebar>
    </>
  );
}

export default NavigationBar;

const styles = {
  backdrop: {
    position: "fixed",
    inset: 0,
    background: "rgba(2,6,23,0.22)",
    zIndex: 39,
  },

  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 10,
    padding: "14px 12px",
    borderBottom: "1px solid rgba(15,23,42,0.06)",
    background: "rgba(248,250,252,0.85)",
  },

  brandRow: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    minWidth: 0,
  },

  logo: {
    height: 36,
    width: 36,
    borderRadius: 12,
    background: "#0f172a",
    color: "#fff",
    display: "grid",
    placeItems: "center",
    fontWeight: 900,
    flexShrink: 0,
  },

  brandTitle: {
    fontSize: 15,
    fontWeight: 900,
    color: "#0f172a",
    lineHeight: 1.1,
  },

  brandSub: {
    fontSize: 12,
    color: "#64748b",
    marginTop: 2,
  },

  closeBtn: {
    border: "1px solid rgba(15,23,42,0.10)",
    background: "#fff",
    color: "#475569",
    borderRadius: 12,
    width: 38,
    height: 38,
    cursor: "pointer",
    display: "flex",              // ✅ was grid
    alignItems: "center",         // ✅ center vertically
    justifyContent: "center",     // ✅ center horizontally
    boxShadow: "0 1px 0 rgba(2,6,23,0.04)",
    flexShrink: 0,
    lineHeight: 1,               // ✅ prevents icon baseline weirdness
    padding: 0,                  // ✅ avoid default button padding
  },

  navList: {
    padding: 10,
    display: "grid",
    gap: 6,
    alignContent: "start",
  },

  navItem: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "10px 12px",
    borderRadius: 14,
    textDecoration: "none",
    color: "#334155",
    fontWeight: 700,
    border: "1px solid transparent",
    background: "transparent",
  },

  navItemActive: {
    color: "#0f172a",
    background: "rgba(248,250,252,0.95)",
    border: "1px solid rgba(15,23,42,0.08)",
    boxShadow: "0 6px 18px rgba(2,6,23,0.04)",
  },

  navIcon: {
    width: 18,
    height: 18,
    display: "grid",
    placeItems: "center",
    color: "#64748b",
    fontSize: 18,
    flexShrink: 0,
  },

  navIconActive: {
    color: "#eb0a0a",
  },

  footer: {
    marginTop: "auto",
    padding: 10,
    borderTop: "1px solid rgba(15,23,42,0.06)",
  },

  signOutBtn: {
    width: "100%",
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "10px 12px",
    borderRadius: 14,
    border: "1px solid rgba(239,68,68,0.16)",
    background: "rgba(254,242,242,0.9)",
    color: "#b91c1c",
    fontWeight: 800,
    cursor: "pointer",
    textAlign: "left",
  },

  signOutIcon: {
    width: 18,
    height: 18,
    display: "grid",
    placeItems: "center",
    fontSize: 16,
    flexShrink: 0,
  },
};
