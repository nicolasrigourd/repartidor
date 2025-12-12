import "./topbar.css";

function TopBar({
  title,
  highlight,
  showBack = false,
  onBack,
  rightLabel,
  onRightClick,
}) {
  return (
    <header className="topbar-root">
      <div className="topbar-left">
        {showBack ? (
          <button className="topbar-back-btn" onClick={onBack}>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M15.5 5.5a1 1 0 0 0-1.4-1.4L7.7 10.5a1 1 0 0 0 0 1.4l6.4 6.4a1 1 0 0 0 1.4-1.4L9.5 11.2l6-5.7Z" />
            </svg>
          </button>
        ) : (
          <div className="topbar-spacer" />
        )}
      </div>

      <div className="topbar-center">
        <span className="topbar-title">
          {title}
          {highlight && <span className="topbar-highlight">{highlight}</span>}
        </span>
      </div>

      <div className="topbar-right">
        {rightLabel && onRightClick ? (
          <button className="topbar-right-btn" onClick={onRightClick}>
            {rightLabel}
          </button>
        ) : (
          <div className="topbar-spacer" />
        )}
      </div>
    </header>
  );
}

export default TopBar;
