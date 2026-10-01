"use client";
import React from "react";
import { motion } from "motion/react";
import { cn } from "@/lib/utils";

export function HoverBorderGradient({
  children,
  containerClassName,
  className,
  as: Tag = "button",
  duration = 1.2,
  ...props
}) {
  return (
    <Tag
      className={cn(
        "group relative inline-flex overflow-hidden rounded-full border border-[rgba(123,111,175,0.28)] bg-white/80 p-px text-[0.96rem] font-semibold shadow-[0_12px_24px_rgba(123,111,175,0.12)] transition-transform duration-200 hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgba(123,111,175,0.35)]",
        containerClassName,
      )}
      {...props}
    >
      <motion.span
        aria-hidden="true"
        className="absolute inset-0 rounded-full opacity-80"
        initial={{ background: "radial-gradient(circle at 50% 50%, rgba(123,111,175,0.08), transparent 60%)" }}
        whileHover={{
          background: [
            "radial-gradient(circle at 50% 50%, rgba(123,111,175,0.12), transparent 60%)",
            "radial-gradient(circle at 30% 30%, rgba(123,111,175,0.2), transparent 62%)",
            "radial-gradient(circle at 50% 50%, rgba(123,111,175,0.08), transparent 60%)",
          ],
        }}
        transition={{ duration, ease: "easeInOut" }}
      />
      <span className="absolute inset-[1px] rounded-full bg-white" />
      <span className={cn("relative z-10 inline-flex items-center justify-center rounded-full bg-white px-5 py-3 text-[var(--primary-strong)] transition-colors duration-200 group-hover:text-[var(--primary)]", className)}>
        {children}
      </span>
    </Tag>
  );
}
