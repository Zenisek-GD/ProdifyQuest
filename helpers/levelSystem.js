/*
  MIT License
  
  Copyright (c) 2025 Christian I. Cabrera || XianFire Framework
  Mindoro State University - Philippines

  Permission is hereby granted, free of charge, to any person obtaining a copy
  of this software and associated documentation files (the "Software"), to deal
  in the Software without restriction, including without limitation the rights
  to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
  copies of the Software, and to permit persons to whom the Software is
  furnished to do so, subject to the following conditions:

  The above copyright notice and this permission notice shall be included in all
  copies or substantial portions of the Software.

  THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
  IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
  FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
  AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
  LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
  OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
  SOFTWARE.
*/

/**
 * Get EXP required to reach the next level
 * Level 1 = 100 EXP, Level 2 = 200 EXP, Level 3 = 400 EXP, etc.
 * Formula: 100 * 2^(level - 1)
 * @param {number} level - The current level
 * @returns {number} EXP needed to reach next level
 */
const getExpForLevel = (level) => {
  return 100 * Math.pow(2, level - 1);
};

/**
 * Calculate level and remaining EXP from total EXP earned
 * @param {number} totalExp - Total experience points
 * @returns {object} { level, exp } - Final level and remaining EXP for current level
 */
const calculateLevelFromExp = (totalExp) => {
  let level = 1;
  let remainingExp = totalExp;
  
  while (remainingExp >= getExpForLevel(level)) {
    remainingExp -= getExpForLevel(level);
    level += 1;
  }
  
  return { level, exp: remainingExp };
};

/**
 * Get total EXP needed to reach a specific level
 * @param {number} targetLevel - The level to calculate cumulative EXP for
 * @returns {number} Total EXP needed
 */
const getTotalExpForLevel = (targetLevel) => {
  let total = 0;
  for (let i = 1; i < targetLevel; i++) {
    total += getExpForLevel(i);
  }
  return total;
};

/**
 * Get EXP progress for display
 * @param {number} currentLevel - Current level
 * @param {number} currentExp - Current EXP in this level (remaining, not total)
 * @returns {object} { expNeeded, expPercent } - For progress bar display
 */
const getExpProgress = (currentLevel, currentExp) => {
  const expNeeded = getExpForLevel(currentLevel);
  const expPercent = Math.min((currentExp / expNeeded) * 100, 100);
  
  return {
    expNeeded,
    expPercent,
    currentExp,
    currentLevel
  };
};

/**
 * Convert from database storage (level + remaining exp) to total accumulated exp
 * Used when you need total EXP from stored level/exp values
 * @param {number} level - Current level
 * @param {number} remainingExp - Remaining EXP in current level
 * @returns {number} Total accumulated EXP
 */
const getTotalExpFromStoredValues = (level, remainingExp) => {
  const totalForLevel = getTotalExpForLevel(level);
  return totalForLevel + remainingExp;
};

export const levelSystem = {
  getExpForLevel,
  calculateLevelFromExp,
  getTotalExpForLevel,
  getExpProgress,
  getTotalExpFromStoredValues
};
