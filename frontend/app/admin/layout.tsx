import AdminGate from '../../components/admin/AdminGate';
import './admin.css';

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <AdminGate><div className="adm">{children}</div></AdminGate>;
}
