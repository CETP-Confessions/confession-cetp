"use client";
import React, { useState, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import { useReducedMotion } from "motion/react";
import { cn } from "@/lib/utils";

export const LayoutTextFlip = ({
  text = "Build Amazing",
  words = ["Landing Pages", "Component Blocks", "Page Sections", "3D Shaders"],
  duration = 2200,
  className,
  textClassName,
  wordClassName,
}) => {
  const [currentIndex, setCurrentIndex] = useState(0);
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    if (reduceMotion || !words.length) return;
    const interval = setInterval(() => {
      setCurrentIndex((prevIndex) => (prevIndex + 1) % words.length);
    }, duration);

    return () => clearInterval(interval);
  }, [duration, reduceMotion, words.length]);

  const displayWord = reduceMotion ? words[0] : words[currentIndex] ?? words[0];

  return (
    <span className="hero-text-flip-inline">
      <motion.span
        layoutId="subtext"
        className={cn("font-bold tracking-tight drop-shadow-sm", textClassName)}
      >
        {text}
      </motion.span>

      <motion.span
        layout
        className={cn(
          "relative inline-flex w-fit max-w-full overflow-hidden rounded-md px-2 py-1 font-sans font-bold tracking-tight drop-shadow-sm",
          className,
        )}
      >
        <AnimatePresence mode="wait">
          <motion.span
            key={displayWord}
            initial={reduceMotion ? false : { y: -24, opacity: 0, filter: "blur(8px)" }}
            animate={{ y: 0, opacity: 1, filter: "blur(0px)" }}
            exit={reduceMotion ? undefined : { y: 18, opacity: 0, filter: "blur(8px)" }}
            transition={{ duration: reduceMotion ? 0 : 0.42, ease: "easeOut" }}
            className={cn("inline-block whitespace-nowrap", wordClassName)}
          >
            {displayWord}
          </motion.span>
        </AnimatePresence>
      </motion.span>
    </span>
  );
};
