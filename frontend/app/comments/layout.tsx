import FeatureGate from '../../components/FeatureGate';

// A switched-off section never shows its page, even from a typed address.
export default function SectionLayout({ children }: { children: React.ReactNode }) {
  return <FeatureGate feature="inbox">{children}</FeatureGate>;
}
