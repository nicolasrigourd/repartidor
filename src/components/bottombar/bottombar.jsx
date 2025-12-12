import "./bottomBar.css";

const TABS = [
  { id: "home", label: "Home", icon: "home" },
  { id: "pedidos", label: "Pedidos", icon: "box" },
  { id: "billetera", label: "Billetera", icon: "wallet" },
  { id: "perfil", label: "Perfil", icon: "user" },
];

function renderIcon(iconId) {
  switch (iconId) {
    case "home":
      return (
        <path d="M12 3.1 3.5 9.3c-.3.2-.5.6-.5 1v9.2c0 .8.7 1.5 1.5 1.5h4c.6 0 1-.4 1-1v-4.5h4v4.5c0 .6.4 1 1 1h4c.8 0 1.5-.7 1.5-1.5v-9.2c0-.4-.2-.8-.5-1L12 3.1Z" />
      );
    case "box":
      return (
        <path d="M5 5h14a1 1 0 0 1 1 1v3H4V6a1 1 0 0 1 1-1Zm-1 6h16v7a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-7Zm4 2v3h2v-3H8Zm5 0v3h2v-3h-2Z" />
      );
    case "wallet":
      return (
        <path d="M4 7a3 3 0 0 1 3-3h10a2 2 0 0 1 2 2v3h-1.5a3.5 3.5 0 1 0 0 7H19v2a2 2 0 0 1-2 2H7a3 3 0 0 1-3-3V7Zm13 7.5a1.5 1.5 0 0 1 0-3H20v3h-3Z" />
      );
    case "user":
      return (
        <path d="M12 4a4 4 0 1 1 0 8 4 4 0 0 1 0-8Zm0 9c-4 0-7 2-7 4.5V19a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-1.5C19 15 16 13 12 13Z" />
      );
    default:
      return null;
  }
}

function BottomBar({ activeTab, onChangeTab }) {
  return (
    <nav className="bottombar-root">
      {TABS.map((tab) => {
        const isActive = tab.id === activeTab;
        return (
          <button
            key={tab.id}
            className={`bottombar-tab ${
              isActive ? "bottombar-tab-active" : ""
            }`}
            onClick={() => onChangeTab(tab.id)}
          >
            <div className="bottombar-icon">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                {renderIcon(tab.icon)}
              </svg>
            </div>
            <span className="bottombar-label">{tab.label}</span>
          </button>
        );
      })}
    </nav>
  );
}

export default BottomBar;
