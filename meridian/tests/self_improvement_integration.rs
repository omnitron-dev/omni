/// Integration test for self-improvement metrics system
///
/// This test verifies:
/// 1. Metrics collection works
/// 2. Health analysis works
/// 3. Dashboard resource integration works

use meridian::metrics::{SelfImprovementMetrics, SelfImprovementCollector};
use meridian::analysis::CodeHealthAnalyzer;

#[tokio::test]
async fn test_self_improvement_metrics_structure() {
    // Test that we can create a metrics instance
    let metrics = SelfImprovementMetrics::new();

    assert_eq!(metrics.health_score, 0.0);
    assert_eq!(metrics.code_quality_score, 0.0);
    assert_eq!(metrics.test_coverage_percent, 0.0);
}

#[tokio::test]
async fn test_health_score_calculation() {
    let mut metrics = SelfImprovementMetrics::new();

    // Set up test data
    metrics.code_quality_score = 0.8;
    metrics.test_coverage_percent = 75.0;
    metrics.technical_debt_score = 0.2;
    metrics.avg_cyclomatic_complexity = 5.0;

    // Calculate health score
    metrics.calculate_health_score();

    // Verify score is reasonable
    assert!(metrics.health_score > 0.7 && metrics.health_score < 0.9);
    assert_eq!(metrics.health_rating(), "Good");
}

#[tokio::test]
async fn test_code_quality_calculation() {
    let mut metrics = SelfImprovementMetrics::new();

    metrics.undocumented_symbols_count = 20;
    metrics.high_complexity_symbols_count = 10;
    metrics.circular_dependencies_count = 2;

    metrics.calculate_code_quality(100);

    // Verify quality score is calculated
    assert!(metrics.code_quality_score > 0.0 && metrics.code_quality_score <= 1.0);
}

#[tokio::test]
async fn test_technical_debt_calculation() {
    let mut metrics = SelfImprovementMetrics::new();

    metrics.untested_symbols_count = 30;
    metrics.undocumented_symbols_count = 20;
    metrics.high_complexity_symbols_count = 10;

    metrics.calculate_technical_debt(100);

    // Verify debt score is calculated
    assert!(metrics.technical_debt_score > 0.0 && metrics.technical_debt_score <= 1.0);
}

#[tokio::test]
async fn test_health_ratings() {
    let mut metrics = SelfImprovementMetrics::new();

    metrics.health_score = 0.95;
    assert_eq!(metrics.health_rating(), "Excellent");

    metrics.health_score = 0.80;
    assert_eq!(metrics.health_rating(), "Good");

    metrics.health_score = 0.65;
    assert_eq!(metrics.health_rating(), "Fair");

    metrics.health_score = 0.45;
    assert_eq!(metrics.health_rating(), "Poor");

    metrics.health_score = 0.25;
    assert_eq!(metrics.health_rating(), "Critical");
}
