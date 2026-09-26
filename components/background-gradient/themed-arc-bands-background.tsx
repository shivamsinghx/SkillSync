import { type HTMLAttributes, type ReactNode } from "react";

import { cn } from "@/lib/cn";
import { ArcBandsBackground } from "@/components/background-gradient/arc-bands-background";
import { DarkArcBandsBackground } from "@/components/background-gradient/dark-arc-bands-background";

export function ThemedArcBandsBackground({
  children,
  className,
  ...props
}: HTMLAttributes<HTMLElement> & { children?: ReactNode }) {
  return (
    <main
      className={cn("relative min-h-screen text-foreground", className)}
      {...props}
    >
      <ArcBandsBackground className="pointer-events-none fixed inset-0 z-0 dark:hidden" />
      <DarkArcBandsBackground className="pointer-events-none fixed inset-0 z-0 hidden dark:block" />
      <div className="relative z-10 min-h-screen w-full min-w-0">
        {children}
      </div>
    </main>
  );
}
