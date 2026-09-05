import Link from "next/link";
export default function NotFound() { return <div className="page-stack"><section className="empty-state"><h1>Workspace not found</h1><p>This role may have been removed or the link is incorrect.</p><Link className="button button-primary" href="/jobs">Back to saved roles</Link></section></div>; }
