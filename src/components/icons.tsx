import type { ReactNode, SVGProps } from "react";

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, "width" | "height"> {
  size?: number;
}

interface IconFrameProps extends IconProps {
  children: ReactNode;
}

function IconFrame({ size = 16, children, ...props }: IconFrameProps) {
  const labelled = typeof props["aria-label"] === "string";
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={labelled ? undefined : true}
      focusable="false"
      {...props}
    >
      {children}
    </svg>
  );
}

export function ArrowLeftIcon(props: IconProps) {
  return <IconFrame {...props}><path d="m15 18-6-6 6-6" /></IconFrame>;
}

export function RefreshIcon(props: IconProps) {
  return <IconFrame {...props}><path d="M20 6v5h-5" /><path d="M4 18v-5h5" /><path d="M6.1 9a7 7 0 0 1 11.4-2.5L20 9M4 15l2.5 2.5A7 7 0 0 0 17.9 15" /></IconFrame>;
}

export function SettingsIcon(props: IconProps) {
  return <IconFrame {...props}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21h-4v-.2a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1-2.8-2.8.1-.1A1.7 1.7 0 0 0 4.8 15a1.7 1.7 0 0 0-1.5-1H3v-4h.3a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.8l-.1-.1 2.8-2.8.1.1a1.7 1.7 0 0 0 1.8.3 1.7 1.7 0 0 0 1-1.5V3h4v.2a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1 2.8 2.8-.1.1a1.7 1.7 0 0 0-.3 1.8 1.7 1.7 0 0 0 1.5 1h.2v4h-.2a1.7 1.7 0 0 0-1.5 1Z" /></IconFrame>;
}

export function CloseIcon(props: IconProps) {
  return <IconFrame {...props}><path d="m18 6-12 12M6 6l12 12" /></IconFrame>;
}

export function ChevronDownIcon(props: IconProps) {
  return <IconFrame {...props}><path d="m6 9 6 6 6-6" /></IconFrame>;
}

export function CheckIcon(props: IconProps) {
  return <IconFrame {...props}><path d="m5 12 4 4L19 6" /></IconFrame>;
}

export function InfoIcon(props: IconProps) {
  return <IconFrame {...props}><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></IconFrame>;
}

export function AlertTriangleIcon(props: IconProps) {
  return <IconFrame {...props}><path d="M10.3 3.7 2.4 18a2 2 0 0 0 1.8 3h15.6a2 2 0 0 0 1.8-3L13.7 3.7a2 2 0 0 0-3.4 0Z" /><path d="M12 9v4M12 17h.01" /></IconFrame>;
}

export function PlusIcon(props: IconProps) {
  return <IconFrame {...props}><path d="M12 5v14M5 12h14" /></IconFrame>;
}

export function MoreHorizontalIcon(props: IconProps) {
  return <IconFrame {...props}><circle cx="5" cy="12" r="1" fill="currentColor" stroke="none" /><circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" /><circle cx="19" cy="12" r="1" fill="currentColor" stroke="none" /></IconFrame>;
}

export function CopyIcon(props: IconProps) {
  return <IconFrame {...props}><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" /></IconFrame>;
}

export function EditIcon(props: IconProps) {
  return <IconFrame {...props}><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4Z" /></IconFrame>;
}

export function TrashIcon(props: IconProps) {
  return <IconFrame {...props}><path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5" /></IconFrame>;
}

export function EyeIcon(props: IconProps) {
  return <IconFrame {...props}><path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12Z" /><circle cx="12" cy="12" r="2.5" /></IconFrame>;
}

export function EyeOffIcon(props: IconProps) {
  return <IconFrame {...props}><path d="m3 3 18 18M10.6 6.2A10.8 10.8 0 0 1 12 6c6.5 0 10 6 10 6a16.7 16.7 0 0 1-2.1 2.8M6.7 6.7C3.7 8.3 2 12 2 12s3.5 6 10 6c1.6 0 3-.4 4.2-1" /><path d="M10.7 10.7a2 2 0 0 0 2.6 2.6" /></IconFrame>;
}

export function ExternalLinkIcon(props: IconProps) {
  return <IconFrame {...props}><path d="M14 4h6v6M20 4l-9 9" /><path d="M18 13v5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h5" /></IconFrame>;
}

export function UserIcon(props: IconProps) {
  return <IconFrame {...props}><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></IconFrame>;
}

export function CodeIcon(props: IconProps) {
  return <IconFrame {...props}><path d="m8 9-3 3 3 3M16 9l3 3-3 3M14 6l-4 12" /></IconFrame>;
}

export function PaletteIcon(props: IconProps) {
  return <IconFrame {...props}><path d="M12 3a9 9 0 0 0 0 18h1.5a1.5 1.5 0 0 0 0-3H12a2 2 0 0 1 0-4h2a7 7 0 0 0 0-14Z" /><circle cx="7.5" cy="10" r=".8" fill="currentColor" stroke="none" /><circle cx="9.5" cy="6.5" r=".8" fill="currentColor" stroke="none" /><circle cx="14" cy="6.5" r=".8" fill="currentColor" stroke="none" /></IconFrame>;
}

export function DownloadIcon(props: IconProps) {
  return <IconFrame {...props}><path d="M12 3v12M7 10l5 5 5-5M5 21h14" /></IconFrame>;
}

export function BellIcon(props: IconProps) {
  return <IconFrame {...props}><path d="M18 8a6 6 0 0 0-12 0c0 7-3 8-3 8h18s-3-1-3-8M14 20h-4" /></IconFrame>;
}

export function ClockIcon(props: IconProps) {
  return <IconFrame {...props}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></IconFrame>;
}

export function MonitorIcon(props: IconProps) {
  return <IconFrame {...props}><rect x="3" y="4" width="18" height="13" rx="2" /><path d="M8 21h8M12 17v4" /></IconFrame>;
}

export function SunIcon(props: IconProps) {
  return <IconFrame {...props}><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></IconFrame>;
}

export function MoonIcon(props: IconProps) {
  return <IconFrame {...props}><path d="M20.5 14.4A8 8 0 0 1 9.6 3.5 8.5 8.5 0 1 0 20.5 14.4Z" /></IconFrame>;
}
