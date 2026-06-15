import { Icon, type IconName } from "./Icons.js";

export type CockpitTab =
  | "live"
  | "scene"
  | "avatar"
  | "voice"
  | "model"
  | "persona"
  | "memory"
  | "safety"
  | "viewers"
  | "logs"
  | "settings";

type SidebarItem = {
  id: CockpitTab;
  label: string;
  icon: IconName;
  badge?: {
    hot?: boolean;
    text: string;
  };
};

const groups: Array<{ label: string; items: SidebarItem[] }> = [
  {
    label: "Cabina",
    items: [{ id: "live", label: "Live", icon: "live", badge: { hot: true, text: "EN VIVO" } }]
  },
  {
    label: "Produccion",
    items: [
      { id: "scene", label: "Escena", icon: "scene" },
      { id: "avatar", label: "Avatar", icon: "avatar" },
      { id: "voice", label: "Voz", icon: "voice" },
      { id: "model", label: "Modelo", icon: "bot" }
    ]
  },
  {
    label: "Personaje",
    items: [
      { id: "persona", label: "Persona", icon: "persona" },
      { id: "memory", label: "Memoria", icon: "memory" },
      { id: "safety", label: "Seguridad", icon: "safety" }
    ]
  },
  {
    label: "Operacion",
    items: [
      { id: "viewers", label: "Directo", icon: "viewers" },
      { id: "logs", label: "Logs", icon: "logs" },
      { id: "settings", label: "Ajustes", icon: "settings" }
    ]
  }
];

export function Sidebar({
  activeTab,
  mobileOpen,
  modelLabel,
  personaName,
  ready,
  liveActive,
  warning,
  onMobileClose,
  onSelect
}: {
  activeTab: CockpitTab;
  mobileOpen: boolean;
  modelLabel: string;
  personaName: string;
  ready: boolean;
  liveActive: boolean;
  warning: boolean;
  onMobileClose: () => void;
  onSelect: (tab: CockpitTab) => void;
}) {
  const yukoName = personaName || "Yuko";
  const yukoState = ready ? (warning ? "atencion" : "operativa") : "iniciando";
  const modelBadge = modelLabel.replace(/^Respondiendo ·\s*/i, "").replace(/^Fallback activo$/i, "Fallback");

  return (
    <>
      <aside className={`sidebar lumaSidebar ${mobileOpen ? "mobile-open" : ""}`} aria-label="Navegacion principal">
        <div className="brand">
          <div className="brand__avatar" aria-hidden="true">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
              <path d="M5 4c0 5 3 7 7 7s7-2 7-7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
              <circle cx="9" cy="13" r="1.3" fill="currentColor" />
              <circle cx="15" cy="13" r="1.3" fill="currentColor" />
              <path d="M9.5 17c.8.8 1.7 1.2 2.5 1.2s1.7-.4 2.5-1.2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          </div>
          <div className="brand__text">
            <div className="brand__name">Mi<em>VtuberIA</em></div>
            <div className="brand__sub"><span className="dot" /> v{__APP_VERSION__} · local</div>
          </div>
        </div>

        <div className="yuko-card">
          <div className="yuko-card__portrait" aria-hidden="true">
            <svg width="28" height="28" viewBox="0 0 32 32" fill="none">
              <path d="M7 12c0 4 4 8 9 8s9-4 9-8" stroke="#5A1F40" strokeWidth="1.6" strokeLinecap="round" />
              <circle cx="12" cy="15" r="1.4" fill="#5A1F40" />
              <circle cx="20" cy="15" r="1.4" fill="#5A1F40" />
              <path d="M14 18.5c.6.6 1.3.9 2 .9s1.4-.3 2-.9" stroke="#5A1F40" strokeWidth="1.4" strokeLinecap="round" />
              <path d="M16 9c2 0 4 1 5 3M16 9c-2 0-4 1-5 3" stroke="#5A1F40" strokeWidth="1.4" strokeLinecap="round" opacity="0.6" />
            </svg>
          </div>
          <div className="yuko-card__meta">
            <div className="yuko-card__name">{yukoName}</div>
            <div className="yuko-card__status">
              <span className="pulse" /> {yukoState} · local
            </div>
          </div>
        </div>

        <nav className="nav" aria-label="Secciones del cockpit">
          {groups.map((group) => (
            <div className="nav__group" key={group.label}>
              <div className="nav__group-label">{group.label}</div>
              {group.items.map((item) => (
                <NavItem
                  key={item.id}
                  item={
                    item.id === "model" && modelBadge
                      ? { ...item, badge: { text: modelBadge } }
                      : item.id === "live"
                        ? { ...item, badge: { hot: liveActive, text: liveActive ? "EN VIVO" : "OFFLINE" } }
                        : item
                  }
                  active={activeTab === item.id}
                  onClick={() => {
                    onSelect(item.id);
                    onMobileClose();
                  }}
                />
              ))}
            </div>
          ))}
        </nav>

        <div className="sidebar__footer">
          <div className="op" aria-hidden="true">
            <Icon name="user" size={15} />
          </div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ color: "var(--text-hi)", fontWeight: 600, fontSize: 13 }}>Operador local</div>
            <div style={{ fontSize: 11, color: "var(--text-lo)" }}>{ready ? "sesion activa" : "esperando backend"}</div>
          </div>
          <button className="icon-btn" title="Preferencias" onClick={() => onSelect("settings")} type="button">
            <Icon name="settings" size={16} />
          </button>
        </div>
      </aside>
      <button
        aria-label="Cerrar navegacion"
        className={`sidebarScrim ${mobileOpen ? "visible" : ""}`}
        onClick={onMobileClose}
        type="button"
      />
    </>
  );
}

function NavItem({ item, active, onClick }: { item: SidebarItem; active: boolean; onClick: () => void }) {
  return (
    <button
      aria-current={active ? "page" : undefined}
      aria-label={item.label}
      className={`nav__item ${active ? "nav__item--active" : ""}`}
      onClick={onClick}
      title={item.label}
      type="button"
    >
      <Icon name={item.icon} size={17} />
      <span className="nav__item-label">{item.label}</span>
      {item.badge && (
        <span className={`nav__badge ${item.badge.hot ? "nav__badge--hot" : ""}`}>
          {item.badge.hot && <span className="nav__badge-dot" />}
          {item.badge.text}
        </span>
      )}
    </button>
  );
}
