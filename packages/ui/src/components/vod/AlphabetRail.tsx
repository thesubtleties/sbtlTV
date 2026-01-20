/**
 * AlphabetRail - A-Z quick navigation for gallery view
 *
 * Vertical strip with magnifying effect on current/hovered letter.
 * Supports both click and drag to navigate.
 */

import { useRef, useState, useCallback, useEffect } from 'react';
import './AlphabetRail.css';

const LETTERS = ['#', 'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z'];

export interface AlphabetRailProps {
  currentLetter: string;
  availableLetters: Set<string>;
  onLetterSelect: (letter: string) => void;
}

export function AlphabetRail({
  currentLetter,
  availableLetters,
  onLetterSelect,
}: AlphabetRailProps) {
  const railRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [hoveredLetter, setHoveredLetter] = useState<string | null>(null);

  // Get letter from Y position
  const getLetterFromY = useCallback((clientY: number): string | null => {
    const rail = railRef.current;
    if (!rail) return null;

    const rect = rail.getBoundingClientRect();
    const relativeY = clientY - rect.top;
    const letterHeight = rect.height / LETTERS.length;
    const index = Math.floor(relativeY / letterHeight);

    if (index >= 0 && index < LETTERS.length) {
      return LETTERS[index];
    }
    return null;
  }, []);

  // Handle click
  const handleClick = useCallback((letter: string) => {
    if (availableLetters.has(letter)) {
      onLetterSelect(letter);
    }
  }, [availableLetters, onLetterSelect]);

  // Handle drag start
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    setIsDragging(true);
    const letter = getLetterFromY(e.clientY);
    if (letter && availableLetters.has(letter)) {
      onLetterSelect(letter);
    }
  }, [getLetterFromY, availableLetters, onLetterSelect]);

  // Handle drag move
  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      const letter = getLetterFromY(e.clientY);
      if (letter) {
        setHoveredLetter(letter);
        if (availableLetters.has(letter)) {
          onLetterSelect(letter);
        }
      }
    };

    const handleMouseUp = () => {
      setIsDragging(false);
      setHoveredLetter(null);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, getLetterFromY, availableLetters, onLetterSelect]);

  // Handle hover
  const handleMouseEnter = useCallback((letter: string) => {
    if (!isDragging) {
      setHoveredLetter(letter);
    }
  }, [isDragging]);

  const handleMouseLeave = useCallback(() => {
    if (!isDragging) {
      setHoveredLetter(null);
    }
  }, [isDragging]);

  const activeLetter = hoveredLetter || currentLetter;

  return (
    <div
      className={`alphabet-rail ${isDragging ? 'alphabet-rail--dragging' : ''}`}
      ref={railRef}
      onMouseDown={handleMouseDown}
    >
      {LETTERS.map((letter) => {
        const isActive = letter === activeLetter;
        const isAvailable = availableLetters.has(letter);
        const isCurrent = letter === currentLetter && !hoveredLetter;

        return (
          <button
            key={letter}
            className={`alphabet-rail__letter ${isActive ? 'alphabet-rail__letter--active' : ''} ${isCurrent ? 'alphabet-rail__letter--current' : ''} ${!isAvailable ? 'alphabet-rail__letter--unavailable' : ''}`}
            onClick={() => handleClick(letter)}
            onMouseEnter={() => handleMouseEnter(letter)}
            onMouseLeave={handleMouseLeave}
            disabled={!isAvailable}
            aria-label={`Jump to ${letter === '#' ? 'numbers' : letter}`}
          >
            {letter}
          </button>
        );
      })}

      {/* Magnified indicator */}
      {(hoveredLetter || isDragging) && (
        <div className="alphabet-rail__magnifier">
          {activeLetter}
        </div>
      )}
    </div>
  );
}

export default AlphabetRail;
