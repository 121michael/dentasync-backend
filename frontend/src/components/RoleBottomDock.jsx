export function RoleBottomDock({
  variant = "wide",
  hidden = false,
  menu,
  children,
}) {
  return (
    <div
      className={`role-bottom-dock role-bottom-dock--${variant}${hidden ? " is-hidden" : ""}`}
    >
      {menu}
      {children}
    </div>
  );
}
