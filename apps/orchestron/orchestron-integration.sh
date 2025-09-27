#!/bin/bash

# ORCHESTRON v2.0 Integration Script - Enhanced Workflow Helper
# Provides quick access to unified development management

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color
BOLD='\033[1m'

# ORCHESTRON command
ORCHESTRON="orchestron"

# Helper functions
print_header() {
    echo -e "\n${CYAN}${BOLD}$1${NC}\n"
}

print_success() {
    echo -e "${GREEN}✅ $1${NC}"
}

print_error() {
    echo -e "${RED}❌ $1${NC}"
}

print_info() {
    echo -e "${BLUE}ℹ️  $1${NC}"
}

# Check if ORCHESTRON is installed
check_orchestron() {
    if ! command -v $ORCHESTRON &> /dev/null; then
        print_error "ORCHESTRON v2.0 not found. Installing..."
        cd aletheia-orchestron && npm run link:global
        cd ..
    fi
}

check_orchestron

# Main menu
show_menu() {
    print_header "🧠 ORCHESTRON v2.0 Quick Actions"
    echo "1) Status Dashboard"
    echo "2) Quick Task/TODO"
    echo "3) Commit & Track"
    echo "4) Sprint Management"
    echo "5) Analytics"
    echo "6) Interactive Mode"
    echo "0) Exit"
    echo
    read -p "Select option: " choice
}

# Quick status
quick_status() {
    print_header "📊 Current Status"
    $ORCHESTRON status
    echo
    $ORCHESTRON stats | head -10
}

# Quick task/todo
quick_task() {
    print_header "📝 Quick Task/TODO"
    echo "1) Add TODO"
    echo "2) Create task"
    echo "3) Update task"
    read -p "Select: " task_choice

    case $task_choice in
        1)
            read -p "TODO: " todo
            $ORCHESTRON todo "$todo"
            print_success "TODO added"
            ;;
        2)
            read -p "Task title: " title
            read -p "Priority (high/medium/low): " priority
            $ORCHESTRON task create "$title" --priority ${priority:-medium}
            print_success "Task created"
            ;;
        3)
            $ORCHESTRON task list --mine | head -10
            read -p "Task ID: " task_id
            read -p "New status: " status
            $ORCHESTRON task update $task_id --status $status
            print_success "Task updated"
            ;;
    esac
}

# Enhanced git commit tracking
track_git_commit() {
    local commit_msg="${1:-}"

    if [ -z "$commit_msg" ]; then
        read -p "Commit message: " commit_msg
    fi

    local files_changed=$(git diff --name-only --cached 2>/dev/null || echo "")

    if [ -n "$files_changed" ]; then
        print_info "Tracking in ORCHESTRON..."

        # Determine node type
        node_type="FEATURE"
        if [[ "$commit_msg" =~ ^fix:|^bugfix: ]]; then
            node_type="FIX"
        elif [[ "$commit_msg" =~ ^test: ]]; then
            node_type="TEST"
        elif [[ "$commit_msg" =~ ^refactor: ]]; then
            node_type="REFACTOR"
        elif [[ "$commit_msg" =~ ^docs: ]]; then
            node_type="DOCUMENTATION"
        elif [[ "$commit_msg" =~ ^perf:|^optimize: ]]; then
            node_type="OPTIMIZATION"
        fi

        # Track in ORCHESTRON
        $ORCHESTRON commit -t "$node_type" -m "$commit_msg" -f $files_changed
        print_success "Changes tracked"

        # Check for related task
        if [[ "$commit_msg" =~ TASK-[0-9]+ ]]; then
            task_id=$(echo "$commit_msg" | grep -oE 'TASK-[0-9]+')
            read -p "Update task $task_id progress? (y/n): " update
            if [[ $update == "y" ]]; then
                read -p "Progress %: " progress
                $ORCHESTRON task progress $task_id --set $progress
            fi
        fi
    fi
}

# Sprint management
quick_sprint() {
    print_header "🎯 Sprint Management"
    echo "1) View current sprint"
    echo "2) Sprint burndown"
    echo "3) Add task to sprint"
    read -p "Select: " sprint_choice

    case $sprint_choice in
        1)
            $ORCHESTRON sprint current
            ;;
        2)
            $ORCHESTRON sprint burndown
            ;;
        3)
            read -p "Task ID: " task_id
            read -p "Sprint ID: " sprint_id
            $ORCHESTRON sprint add $task_id $sprint_id
            print_success "Task added to sprint"
            ;;
    esac
}

# Analytics
quick_analytics() {
    print_header "📨 Analytics"
    echo "1) Statistics"
    echo "2) Bottlenecks"
    echo "3) Generate report"
    read -p "Select: " analytics_choice

    case $analytics_choice in
        1)
            $ORCHESTRON stats
            ;;
        2)
            $ORCHESTRON bottlenecks
            ;;
        3)
            $ORCHESTRON report > report-$(date +%Y%m%d).md
            print_success "Report saved"
            ;;
    esac
}

# Function to track errors
track_error() {
    local error_msg="$1"
    local component="$2"
    local severity="${3:-MEDIUM}"

    print_info "Tracking error..."
    orchestron error -m "$error_msg" -c "$component" -s "$severity"
    echo -e "${GREEN}✓ Error tracked${NC}"
}

# Function to track performance benchmarks
track_benchmark() {
    local operation="$1"
    local before="$2"
    local after="$3"

    echo -e "${BLUE}Tracking benchmark in ORCHESTRON...${NC}"
    orchestron benchmark -o "$operation" -b "$before" -a "$after"
    echo -e "${GREEN}✓ Benchmark tracked${NC}"
}

# Function to create development snapshot
create_snapshot() {
    local description="$1"

    echo -e "${BLUE}Creating development snapshot...${NC}"

    # Get current metrics
    orchestron status

    # Generate report
    orchestron report > "reports/orchestron-report-$(date +%Y%m%d-%H%M%S).md"

    echo -e "${GREEN}✓ Snapshot created${NC}"
}

# Function to analyze development patterns
analyze_patterns() {
    echo -e "${BLUE}Analyzing development patterns...${NC}"

    # Check for error patterns
    orchestron analyze-errors

    # Query recent changes
    echo -e "\n${YELLOW}Recent Aletheia Core changes:${NC}"
    orchestron query "aletheia-core"

    echo -e "\n${YELLOW}Recent Aletheia Distributed changes:${NC}"
    orchestron query "aletheia-distributed"
}

# Function to sync ORCHESTRON with git hooks
install_git_hooks() {
    echo -e "${BLUE}Installing Git hooks for ORCHESTRON integration...${NC}"

    # Create post-commit hook
    cat > .git/hooks/post-commit << 'EOF'
#!/bin/bash
# Auto-track commits in ORCHESTRON
commit_msg=$(git log -1 --pretty=%B)
files_changed=$(git diff-tree --no-commit-id --name-only -r HEAD)

if [ -n "$files_changed" ]; then
    orchestron commit -t feature -m "$commit_msg" -f $files_changed 2>/dev/null || true
fi
EOF

    chmod +x .git/hooks/post-commit

    echo -e "${GREEN}✓ Git hooks installed${NC}"
}

# Main menu
show_menu() {
    echo -e "\n${BLUE}=== ORCHESTRON Integration Menu ===${NC}"
    echo "1. Track current git changes"
    echo "2. Track an error"
    echo "3. Track a benchmark"
    echo "4. Create development snapshot"
    echo "5. Analyze patterns"
    echo "6. Install git hooks"
    echo "7. Show ORCHESTRON status"
    echo "8. Generate report"
    echo "9. Exit"
    echo -n "Select option: "
}

# Main script execution
main() {
    # Handle command-line arguments
    if [ $# -gt 0 ]; then
        case "$1" in
            commit)
                shift
                track_git_commit "$@"
                exit 0
                ;;
            snapshot)
                shift
                create_snapshot "$@"
                exit 0
                ;;
            analyze)
                analyze_patterns
                exit 0
                ;;
            status)
                quick_status
                exit 0
                ;;
            interactive)
                $ORCHESTRON interactive
                exit 0
                ;;
            hooks)
                install_git_hooks
                exit 0
                ;;
            *)
                # Pass through to ORCHESTRON
                $ORCHESTRON "$@"
                exit $?
                ;;
        esac
    fi

    # Interactive menu loop
    while true; do
        clear
        show_menu

        case $choice in
            1)
                quick_status
                read -p "Press Enter to continue..."
                ;;
            2)
                quick_task
                read -p "Press Enter to continue..."
                ;;
            3)
                track_git_commit
                read -p "Press Enter to continue..."
                ;;
            4)
                quick_sprint
                read -p "Press Enter to continue..."
                ;;
            5)
                quick_analytics
                read -p "Press Enter to continue..."
                ;;
            6)
                print_info "Starting interactive mode..."
                $ORCHESTRON interactive
                ;;
            0)
                print_info "Goodbye! 👋"
                exit 0
                ;;
            *)
                print_error "Invalid option"
                read -p "Press Enter to continue..."
                ;;
        esac
    done
}

# Run main function
main "$@"