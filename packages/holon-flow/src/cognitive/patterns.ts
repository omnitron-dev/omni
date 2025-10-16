/**
 * Pattern Recognition - Detect patterns in data and sequences
 */

import type { ProcessedExample } from './index.js';

/**
 * Detected pattern
 */
export interface DetectedPattern {
  type: string;
  confidence: number;
  occurrences: number;
  description: string;
  data: Map<string, any>;
}

/**
 * Similarity metric result
 */
export interface SimilarityResult {
  similarity: number;
  commonFeatures: string[];
  uniqueFeatures: string[];
}

/**
 * Cluster
 */
export interface Cluster<T> {
  id: number;
  centroid: T;
  members: T[];
  cohesion: number;
}

/**
 * Pattern recognizer
 */
export class PatternRecognizer {
  /**
   * Detect repeating sequences
   */
  detectSequencePatterns<T>(sequence: T[], minLength = 2, maxLength = 10): DetectedPattern[] {
    const patterns: DetectedPattern[] = [];
    const seen = new Map<string, number>();

    // Sliding window
    for (let length = minLength; length <= Math.min(maxLength, sequence.length / 2); length++) {
      for (let i = 0; i <= sequence.length - length; i++) {
        const window = sequence.slice(i, i + length);
        const key = JSON.stringify(window);

        seen.set(key, (seen.get(key) ?? 0) + 1);
      }
    }

    // Extract patterns that occur multiple times
    for (const [key, count] of seen.entries()) {
      if (count >= 2) {
        patterns.push({
          type: 'sequence',
          confidence: Math.min(count / 10, 1.0),
          occurrences: count,
          description: `Sequence pattern found ${count} times`,
          data: new Map<string, any>([
            ['pattern', key],
            ['count', count],
          ]),
        });
      }
    }

    return patterns;
  }

  /**
   * Detect frequency patterns
   */
  detectFrequencyPatterns<T>(items: T[], minSupport = 0.1): DetectedPattern[] {
    const patterns: DetectedPattern[] = [];
    const counts = new Map<string, number>();

    // Count occurrences
    for (const item of items) {
      const key = JSON.stringify(item);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }

    // Extract frequent items
    const threshold = items.length * minSupport;
    for (const [key, count] of counts.entries()) {
      if (count >= threshold) {
        patterns.push({
          type: 'frequency',
          confidence: count / items.length,
          occurrences: count,
          description: `Item appears ${count} times (${((count / items.length) * 100).toFixed(1)}%)`,
          data: new Map<string, any>([
            ['item', key],
            ['frequency', count / items.length],
          ]),
        });
      }
    }

    return patterns;
  }

  /**
   * Detect temporal patterns
   */
  detectTemporalPatterns(examples: ProcessedExample<any, any>[]): DetectedPattern[] {
    const patterns: DetectedPattern[] = [];

    if (examples.length < 2) return patterns;

    // Sort by timestamp
    const sorted = [...examples].sort((a, b) => a.timestamp - b.timestamp);

    // Calculate time intervals
    const intervals: number[] = [];
    for (let i = 1; i < sorted.length; i++) {
      intervals.push(sorted[i]!.timestamp - sorted[i - 1]!.timestamp);
    }

    // Detect regular intervals
    const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;
    const variance = intervals.reduce((sum, val) => sum + Math.pow(val - avgInterval, 2), 0) / intervals.length;
    const stdDev = Math.sqrt(variance);

    // If variance is low, we have a regular pattern
    if (stdDev < avgInterval * 0.2) {
      patterns.push({
        type: 'temporal',
        confidence: 1 - stdDev / avgInterval,
        occurrences: intervals.length,
        description: `Regular time intervals of ~${avgInterval.toFixed(0)}ms`,
        data: new Map([
          ['interval', avgInterval],
          ['stdDev', stdDev],
        ]),
      });
    }

    return patterns;
  }

  /**
   * Detect correlation patterns
   */
  detectCorrelations(examples: ProcessedExample<any, any>[]): DetectedPattern[] {
    const patterns: DetectedPattern[] = [];

    if (examples.length < 3) return patterns;

    // Extract feature names
    const featureNames = new Set<string>();
    for (const example of examples) {
      for (const key of example.features.keys()) {
        featureNames.add(key);
      }
    }

    // Calculate correlations between features
    const features = Array.from(featureNames);
    for (let i = 0; i < features.length; i++) {
      for (let j = i + 1; j < features.length; j++) {
        const feature1 = features[i]!;
        const feature2 = features[j]!;

        const correlation = this.calculateCorrelation(examples, feature1, feature2);

        if (Math.abs(correlation) > 0.6) {
          patterns.push({
            type: 'correlation',
            confidence: Math.abs(correlation),
            occurrences: examples.length,
            description: `${feature1} and ${feature2} are ${correlation > 0 ? 'positively' : 'negatively'} correlated`,
            data: new Map<string, any>([
              ['feature1', feature1],
              ['feature2', feature2],
              ['correlation', correlation],
            ]),
          });
        }
      }
    }

    return patterns;
  }

  /**
   * Calculate Pearson correlation coefficient
   */
  private calculateCorrelation(
    examples: ProcessedExample<any, any>[],
    feature1: string,
    feature2: string,
  ): number {
    const values1: number[] = [];
    const values2: number[] = [];

    for (const example of examples) {
      const val1 = example.features.get(feature1);
      const val2 = example.features.get(feature2);

      if (typeof val1 === 'number' && typeof val2 === 'number') {
        values1.push(val1);
        values2.push(val2);
      }
    }

    if (values1.length < 2) return 0;

    const mean1 = values1.reduce((a, b) => a + b, 0) / values1.length;
    const mean2 = values2.reduce((a, b) => a + b, 0) / values2.length;

    let numerator = 0;
    let denominator1 = 0;
    let denominator2 = 0;

    for (let i = 0; i < values1.length; i++) {
      const diff1 = values1[i]! - mean1;
      const diff2 = values2[i]! - mean2;

      numerator += diff1 * diff2;
      denominator1 += diff1 * diff1;
      denominator2 += diff2 * diff2;
    }

    const denominator = Math.sqrt(denominator1 * denominator2);
    return denominator === 0 ? 0 : numerator / denominator;
  }
}

/**
 * Feature extractor
 */
export class FeatureExtractor {
  /**
   * Extract features from input
   */
  extract(input: any): Map<string, any> {
    const features = new Map<string, any>();

    if (typeof input === 'object' && input !== null) {
      // Object features
      this.extractObjectFeatures(input, features);
    } else if (typeof input === 'string') {
      // String features
      this.extractStringFeatures(input, features);
    } else if (typeof input === 'number') {
      // Numeric features
      this.extractNumericFeatures(input, features);
    } else if (Array.isArray(input)) {
      // Array features
      this.extractArrayFeatures(input, features);
    }

    return features;
  }

  /**
   * Private: Extract object features
   */
  private extractObjectFeatures(obj: any, features: Map<string, any>, prefix = ''): void {
    for (const [key, value] of Object.entries(obj)) {
      const fullKey = prefix ? `${prefix}.${key}` : key;

      if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        // Recurse into nested objects
        this.extractObjectFeatures(value, features, fullKey);
      } else {
        features.set(fullKey, value);
      }
    }
  }

  /**
   * Private: Extract string features
   */
  private extractStringFeatures(str: string, features: Map<string, any>): void {
    features.set('length', str.length);
    features.set('uppercase_count', (str.match(/[A-Z]/g) || []).length);
    features.set('lowercase_count', (str.match(/[a-z]/g) || []).length);
    features.set('digit_count', (str.match(/\d/g) || []).length);
    features.set('space_count', (str.match(/\s/g) || []).length);
    features.set('word_count', str.split(/\s+/).length);
  }

  /**
   * Private: Extract numeric features
   */
  private extractNumericFeatures(num: number, features: Map<string, any>): void {
    features.set('value', num);
    features.set('sign', Math.sign(num));
    features.set('magnitude', Math.abs(num));
    features.set('is_integer', Number.isInteger(num));
  }

  /**
   * Private: Extract array features
   */
  private extractArrayFeatures(arr: any[], features: Map<string, any>): void {
    features.set('length', arr.length);

    if (arr.every((x) => typeof x === 'number')) {
      const numbers = arr as number[];
      features.set('mean', numbers.reduce((a, b) => a + b, 0) / numbers.length);
      features.set('min', Math.min(...numbers));
      features.set('max', Math.max(...numbers));
    }
  }
}

/**
 * Similarity calculator
 */
export class SimilarityCalculator {
  /**
   * Calculate Jaccard similarity between two sets
   */
  jaccard<T>(set1: Set<T>, set2: Set<T>): number {
    const intersection = new Set([...set1].filter((x) => set2.has(x)));
    const union = new Set([...set1, ...set2]);

    return union.size === 0 ? 0 : intersection.size / union.size;
  }

  /**
   * Calculate cosine similarity between two vectors
   */
  cosine(vec1: number[], vec2: number[]): number {
    if (vec1.length !== vec2.length) return 0;

    let dotProduct = 0;
    let norm1 = 0;
    let norm2 = 0;

    for (let i = 0; i < vec1.length; i++) {
      dotProduct += vec1[i]! * vec2[i]!;
      norm1 += vec1[i]! * vec1[i]!;
      norm2 += vec2[i]! * vec2[i]!;
    }

    const denominator = Math.sqrt(norm1) * Math.sqrt(norm2);
    return denominator === 0 ? 0 : dotProduct / denominator;
  }

  /**
   * Calculate Euclidean distance
   */
  euclidean(vec1: number[], vec2: number[]): number {
    if (vec1.length !== vec2.length) return Infinity;

    let sum = 0;
    for (let i = 0; i < vec1.length; i++) {
      sum += Math.pow(vec1[i]! - vec2[i]!, 2);
    }

    return Math.sqrt(sum);
  }

  /**
   * Calculate Levenshtein distance between strings
   */
  levenshtein(str1: string, str2: string): number {
    const m = str1.length;
    const n = str2.length;
    const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));

    for (let i = 0; i <= m; i++) dp[i]![0] = i;
    for (let j = 0; j <= n; j++) dp[0]![j] = j;

    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        if (str1[i - 1] === str2[j - 1]) {
          dp[i]![j] = dp[i - 1]![j - 1]!;
        } else {
          dp[i]![j] = 1 + Math.min(dp[i - 1]![j]!, dp[i]![j - 1]!, dp[i - 1]![j - 1]!);
        }
      }
    }

    return dp[m]![n]!;
  }

  /**
   * Calculate feature similarity
   */
  featureSimilarity(features1: Map<string, any>, features2: Map<string, any>): SimilarityResult {
    const keys1 = new Set(features1.keys());
    const keys2 = new Set(features2.keys());

    const commonFeatures = Array.from(keys1).filter((k) => keys2.has(k));
    const uniqueFeatures = [...Array.from(keys1).filter((k) => !keys2.has(k)), ...Array.from(keys2).filter((k) => !keys1.has(k))];

    // Calculate similarity based on common features
    let similarity = 0;
    if (commonFeatures.length > 0) {
      let matches = 0;
      for (const key of commonFeatures) {
        const val1 = features1.get(key);
        const val2 = features2.get(key);

        if (val1 === val2) {
          matches++;
        } else if (typeof val1 === 'number' && typeof val2 === 'number') {
          // Numeric similarity
          const diff = Math.abs(val1 - val2);
          const max = Math.max(Math.abs(val1), Math.abs(val2));
          if (max > 0) {
            matches += 1 - Math.min(diff / max, 1);
          }
        }
      }
      similarity = matches / commonFeatures.length;
    }

    return {
      similarity,
      commonFeatures,
      uniqueFeatures,
    };
  }
}

/**
 * K-means clustering
 */
export class KMeansClustering<T> {
  /**
   * Cluster items into k groups
   */
  cluster(
    items: T[],
    k: number,
    distanceFn: (a: T, b: T) => number,
    maxIterations = 100,
  ): Cluster<T>[] {
    if (k >= items.length) {
      // Each item is its own cluster
      return items.map((item, i) => ({
        id: i,
        centroid: item,
        members: [item],
        cohesion: 1.0,
      }));
    }

    // Initialize centroids randomly
    let centroids = this.initializeCentroids(items, k);
    let clusters: Cluster<T>[] = [];
    let iterations = 0;

    while (iterations < maxIterations) {
      iterations++;

      // Assign items to nearest centroid
      clusters = this.assignClusters(items, centroids, distanceFn);

      // Update centroids
      const newCentroids = clusters.map((cluster) => this.calculateCentroid(cluster.members, distanceFn));

      // Check convergence
      if (this.centroidsEqual(centroids, newCentroids, distanceFn)) {
        break;
      }

      centroids = newCentroids;
    }

    // Calculate cohesion for each cluster
    for (const cluster of clusters) {
      cluster.cohesion = this.calculateCohesion(cluster, distanceFn);
    }

    return clusters;
  }

  /**
   * Private: Initialize centroids
   */
  private initializeCentroids(items: T[], k: number): T[] {
    const centroids: T[] = [];
    const used = new Set<number>();

    while (centroids.length < k) {
      const index = Math.floor(Math.random() * items.length);
      if (!used.has(index)) {
        centroids.push(items[index]!);
        used.add(index);
      }
    }

    return centroids;
  }

  /**
   * Private: Assign items to clusters
   */
  private assignClusters(items: T[], centroids: T[], distanceFn: (a: T, b: T) => number): Cluster<T>[] {
    const clusters: Cluster<T>[] = centroids.map((centroid, i) => ({
      id: i,
      centroid,
      members: [],
      cohesion: 0,
    }));

    for (const item of items) {
      let minDistance = Infinity;
      let nearestCluster = 0;

      for (let i = 0; i < centroids.length; i++) {
        const distance = distanceFn(item, centroids[i]!);
        if (distance < minDistance) {
          minDistance = distance;
          nearestCluster = i;
        }
      }

      clusters[nearestCluster]!.members.push(item);
    }

    return clusters;
  }

  /**
   * Private: Calculate centroid
   */
  private calculateCentroid(members: T[], distanceFn: (a: T, b: T) => number): T {
    if (members.length === 0) throw new Error('Empty cluster');

    // Find medoid (member with minimum average distance to others)
    let minAvgDistance = Infinity;
    let medoid: T | undefined = members[0];

    for (const candidate of members) {
      let totalDistance = 0;
      for (const member of members) {
        totalDistance += distanceFn(candidate, member);
      }
      const avgDistance = totalDistance / members.length;

      if (avgDistance < minAvgDistance) {
        minAvgDistance = avgDistance;
        medoid = candidate;
      }
    }

    if (medoid === undefined) {
      throw new Error('Could not find medoid');
    }

    return medoid;
  }

  /**
   * Private: Check if centroids are equal
   */
  private centroidsEqual(c1: T[], c2: T[], distanceFn: (a: T, b: T) => number): boolean {
    if (c1.length !== c2.length) return false;

    for (let i = 0; i < c1.length; i++) {
      if (distanceFn(c1[i]!, c2[i]!) > 0.001) {
        return false;
      }
    }

    return true;
  }

  /**
   * Private: Calculate cluster cohesion
   */
  private calculateCohesion(cluster: Cluster<T>, distanceFn: (a: T, b: T) => number): number {
    if (cluster.members.length <= 1) return 1.0;

    let totalDistance = 0;
    let count = 0;

    for (let i = 0; i < cluster.members.length; i++) {
      for (let j = i + 1; j < cluster.members.length; j++) {
        totalDistance += distanceFn(cluster.members[i]!, cluster.members[j]!);
        count++;
      }
    }

    const avgDistance = count > 0 ? totalDistance / count : 0;
    return 1 / (1 + avgDistance); // Convert distance to cohesion score
  }
}
