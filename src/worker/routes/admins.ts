/** ADMIN_EMAILS: "a@x.com, b@y.com, *@club.com" — exact addresses or whole domains. */
export function isAdminEmail(list: string | undefined, email: string): boolean {
  const e = email.trim().toLowerCase();
  if (!e) return false;
  const domain = e.slice(e.indexOf("@"));
  return (list ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
    .some((entry) => entry === e || (entry.startsWith("*@") && entry.slice(1) === domain));
}
