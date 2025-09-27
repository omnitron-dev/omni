#!/bin/bash

# Script to manage Redis containers for testing

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
DOCKER_COMPOSE_FILE="$PROJECT_DIR/test/docker/docker-compose.test.yml"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
NC='\033[0m' # No Color

# Default values
ACTION=""
SUITE_ID="default"
VERBOSE=false

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        start)
            ACTION="start"
            shift
            ;;
        stop)
            ACTION="stop"
            shift
            ;;
        cleanup)
            ACTION="cleanup"
            shift
            ;;
        status)
            ACTION="status"
            shift
            ;;
        --suite-id)
            SUITE_ID="$2"
            shift 2
            ;;
        --verbose|-v)
            VERBOSE=true
            shift
            ;;
        --help|-h)
            echo "Usage: $0 [start|stop|cleanup|status] [options]"
            echo ""
            echo "Commands:"
            echo "  start    - Start Redis containers for testing"
            echo "  stop     - Stop Redis containers"
            echo "  cleanup  - Remove all test containers, networks, and volumes"
            echo "  status   - Show status of test containers"
            echo ""
            echo "Options:"
            echo "  --suite-id <id>  - Test suite ID (default: default)"
            echo "  --verbose, -v    - Enable verbose output"
            echo "  --help, -h       - Show this help message"
            exit 0
            ;;
        *)
            echo -e "${RED}Unknown option: $1${NC}"
            exit 1
            ;;
    esac
done

# Check if Docker is installed
if ! command -v docker &> /dev/null; then
    echo -e "${RED}Docker is not installed. Please install Docker first.${NC}"
    exit 1
fi

# Check if Docker daemon is running
if ! docker info &> /dev/null; then
    echo -e "${RED}Docker daemon is not running. Please start Docker.${NC}"
    exit 1
fi

# Functions
start_containers() {
    echo -e "${GREEN}Starting Redis containers for suite: $SUITE_ID${NC}"

    export TEST_SUITE_ID="$SUITE_ID"
    export REDIS_PORT="${REDIS_PORT:-6379}"

    if [ "$VERBOSE" = true ]; then
        docker-compose -f "$DOCKER_COMPOSE_FILE" up -d redis-test
    else
        docker-compose -f "$DOCKER_COMPOSE_FILE" up -d redis-test > /dev/null 2>&1
    fi

    if [ $? -eq 0 ]; then
        echo -e "${GREEN}Redis container started successfully on port $REDIS_PORT${NC}"

        # Wait for Redis to be ready
        echo -n "Waiting for Redis to be ready..."
        for i in {1..30}; do
            if docker exec "redis-test-$SUITE_ID" redis-cli ping > /dev/null 2>&1; then
                echo -e " ${GREEN}Ready!${NC}"
                return 0
            fi
            echo -n "."
            sleep 1
        done

        echo -e " ${RED}Timeout!${NC}"
        return 1
    else
        echo -e "${RED}Failed to start Redis container${NC}"
        return 1
    fi
}

stop_containers() {
    echo -e "${YELLOW}Stopping Redis containers for suite: $SUITE_ID${NC}"

    export TEST_SUITE_ID="$SUITE_ID"

    if [ "$VERBOSE" = true ]; then
        docker-compose -f "$DOCKER_COMPOSE_FILE" down
    else
        docker-compose -f "$DOCKER_COMPOSE_FILE" down > /dev/null 2>&1
    fi

    if [ $? -eq 0 ]; then
        echo -e "${GREEN}Redis containers stopped successfully${NC}"
    else
        echo -e "${YELLOW}No containers to stop or error occurred${NC}"
    fi
}

cleanup_all() {
    echo -e "${YELLOW}Cleaning up all test containers, networks, and volumes...${NC}"

    # Stop all test containers
    echo "Stopping test containers..."
    docker ps -a --filter "label=test.cleanup=true" -q | xargs -r docker stop > /dev/null 2>&1

    # Remove all test containers
    echo "Removing test containers..."
    docker ps -a --filter "label=test.cleanup=true" -q | xargs -r docker rm -f > /dev/null 2>&1

    # Remove test networks
    echo "Removing test networks..."
    docker network ls --filter "label=test.cleanup=true" -q | xargs -r docker network rm 2> /dev/null || true

    # Remove test volumes
    echo "Removing test volumes..."
    docker volume ls --filter "label=test.cleanup=true" -q | xargs -r docker volume rm 2> /dev/null || true

    echo -e "${GREEN}Cleanup completed${NC}"
}

show_status() {
    echo -e "${GREEN}Test Container Status:${NC}"
    echo ""

    # Show test containers
    echo "Test Containers:"
    docker ps -a --filter "label=test.cleanup=true" --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"

    echo ""
    echo "Test Networks:"
    docker network ls --filter "label=test.cleanup=true" --format "table {{.Name}}\t{{.Driver}}"

    echo ""
    echo "Test Volumes:"
    docker volume ls --filter "label=test.cleanup=true" --format "table {{.Name}}\t{{.Driver}}"
}

# Execute action
case $ACTION in
    start)
        start_containers
        ;;
    stop)
        stop_containers
        ;;
    cleanup)
        cleanup_all
        ;;
    status)
        show_status
        ;;
    *)
        echo -e "${RED}No action specified. Use --help for usage information.${NC}"
        exit 1
        ;;
esac