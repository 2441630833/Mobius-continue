import { MessageModes } from "core";

interface ModeIconProps {
  mode: MessageModes;
  className?: string;
}

/** Ant Design Outlined paths (RobotOutlined / gamepad for Game). */
function AntDesignModeSvg({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <svg
      className={className}
      viewBox="0 0 1024 1024"
      fill="currentColor"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export function ModeIcon({
  mode,
  className = "xs:h-3 xs:w-3 h-3 w-3",
}: ModeIconProps) {
  switch (mode) {
    case "agent":
      return (
        <AntDesignModeSvg className={className}>
          <path d="M300 328a60 60 0 1 0 120 0 60 60 0 1 0-120 0Z" />
          <path d="M852 64H172c-17.7 0-32 14.3-32 32v660c0 17.7 14.3 32 32 32h680c17.7 0 32-14.3 32-32V96c0-17.7-14.3-32-32-32ZM204 128h616v596H204V128Z" />
          <path d="M604 328a60 60 0 1 0 120 0 60 60 0 1 0-120 0Z" />
          <path d="M852 708H172v52h680v-52Z" />
        </AntDesignModeSvg>
      );
    case "game":
      return (
        <svg
          className={className}
          viewBox="0 0 24 24"
          fill="currentColor"
          aria-hidden="true"
        >
          <path d="M21.58 16.09l-1.09-7.66C20.21 6.46 18.52 5 16.53 5H7.47C5.48 5 3.79 6.46 3.51 8.43l-1.09 7.66C2.2 17.63 3.39 19 4.94 19c.68 0 1.32-.27 1.8-.75L9 16h6l2.25 2.25c.48.48 1.13.75 1.8.75 1.56 0 2.75-1.37 2.53-2.91zM11 11H9v2H8v-2H6v-1h2V8h1v2h2v1zm4-1h1v1h-1v1h-1v-1h-1V9h1V8h1v1z" />
        </svg>
      );
    case "plan":
      return (
        <AntDesignModeSvg className={className}>
          <path d="M880 112H144c-17.7 0-32 14.3-32 32v736c0 17.7 14.3 32 32 32h736c17.7 0 32-14.3 32-32V144c0-17.7-14.3-32-32-32zM513.1 518.1l-192 161c-5.2 4.4-13.1.7-13.1-6.1v-62.7c0-2.3 1.1-4.6 2.9-6.1L420.7 512l-109.8-92.2a7.63 7.63 0 0 1-2.9-6.1V351c0-6.8 7.9-10.5 13.1-6.1l192 160.9c3.9 3.2 3.9 9.1 0 12.3zM716 673c0 4.4-3.4 8-7.5 8h-185c-4.1 0-7.5-3.6-7.5-8v-48c0-4.4 3.4-8 7.5-8h185c4.1 0 7.5 3.6 7.5 8v48z" />
        </AntDesignModeSvg>
      );
    case "chat":
      return (
        <AntDesignModeSvg className={className}>
          <path d="M464 512a48 48 0 1 0 96 0 48 48 0 1 0-96 0zm200 0a48 48 0 1 0 96 0 48 48 0 1 0-96 0zm-400 0a48 48 0 1 0 96 0 48 48 0 1 0-96 0zm661.2-173.6c-22.6-53.7-55-101.9-96.3-143.3a444.35 444.35 0 0 0-143.3-96.3C630.6 75.7 572.2 64 512 64h-2c-60.2.3-118.6 12.3-174.5 35.9a445.35 445.35 0 0 0-142 96.5c-40.9 41.3-73 89.3-95.2 142.8-23 55.4-34.6 114.3-34.3 174.9A449.4 449.4 0 0 0 112 718.8v2c.3 60.2 12.3 118.6 35.9 174.5a444.35 444.35 0 0 0 142 96.5c41.3 40.9 89.3 73 142.8 95.2C394.2 952.7 452.9 964 512 964h2c60.2-.3 118.6-12.3 174.5-35.9 53.2-22.3 101.1-54.3 142.8-95.2 40.9-41.3 73-89.3 95.2-142.8 23.6-55.2 35.2-113.9 35.5-173.5A449.4 449.4 0 0 0 912 305.2v-2.2c-.3-60.2-12.3-118.6-35.9-174.5zM512 880c-88.4 0-160-71.6-160-160s71.6-160 160-160 160 71.6 160 160-71.6 160-160 160z" />
        </AntDesignModeSvg>
      );
    case "background":
      return (
        <AntDesignModeSvg className={className}>
          <path d="M824 804H200c-4.4 0-8 3.4-8 7.6v60.8c0 4.2 3.6 7.6 8 7.6h624c4.4 0 8-3.4 8-7.6v-60.8c0-4.2-3.6-7.6-8-7.6zM811.4 366.7C765.6 245.9 648.9 160 512.2 160S258.8 245.8 213 366.6C127.3 389.4 64 467.2 64 560c0 110.5 89.5 200 199.9 200H814c110.4 0 199.9-89.5 199.9-200 0-92.8-63.1-170.7-148.5-193.3z" />
        </AntDesignModeSvg>
      );
  }
}
