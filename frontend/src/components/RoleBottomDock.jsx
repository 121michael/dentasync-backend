export function RoleBottomDock({
  variant = "wide",
  hidden = false,
  children,
}) {
  return (
    <div
      className={`role-bottom-dock role-bottom-dock--${variant}${hidden ? " is-hidden" : ""}`}
    >
      {children}
    </div>
  );
}
