import {
    Utils,
    DragSourceType,
    SvgFactory,
    Autowired,
    Column,
    Component,
    GridOptionsWrapper,
    ColumnController,
    Events,
    GridPanel,
    Context,
    DragSource,
    DragAndDropService,
    OriginalColumnGroup,
    PostConstruct,
    QuerySelector,
    EventService,
    AgCheckbox
} from "ag-grid/main";

var svgFactory = SvgFactory.getInstance();

export class RenderedGroup extends Component {

    private static TEMPLATE =
        '<div class="ag-column-select-column-group">' +
        '  <span id="eIndent" class="ag-column-select-indent"></span>' +
        '  <span class="ag-column-group-icons">' +
        '    <span id="eGroupOpenedIcon" class="ag-column-group-closed-icon"></span>' +
        '    <span id="eGroupClosedIcon" class="ag-column-group-opened-icon"></span>' +
        '  </span>' +
        '  <ag-checkbox class="ag-column-select-checkbox"></ag-checkbox>' +
        '  <span id="eText" class="ag-column-select-column-group-label"></span>' +
        '</div>';

    @Autowired('gridOptionsWrapper') private gridOptionsWrapper: GridOptionsWrapper;
    @Autowired('columnController') private columnController: ColumnController;
    @Autowired('gridPanel') private gridPanel: GridPanel;
    @Autowired('context') private context: Context;
    @Autowired('dragAndDropService') private dragAndDropService: DragAndDropService;
    @Autowired('eventService') private eventService: EventService;

    @QuerySelector('.ag-column-select-checkbox') private cbSelect: AgCheckbox;

    private columnGroup: OriginalColumnGroup;
    private expanded = true;
    private columnDept: number;

    private eGroupClosedIcon: HTMLElement;
    private eGroupOpenedIcon: HTMLElement;

    private expandedCallback: ()=>void;

    private allowDragging: boolean;

    private displayName: string;

    private processingColumnStateChange = false;

    constructor(columnGroup: OriginalColumnGroup, columnDept: number, expandedCallback: ()=>void, allowDragging: boolean) {
        super(RenderedGroup.TEMPLATE);
        this.columnGroup = columnGroup;
        this.columnDept = columnDept;
        this.expandedCallback = expandedCallback;
        this.allowDragging = allowDragging;
    }

    @PostConstruct
    public init(): void {
        this.instantiate(this.context);

        var eText = this.queryForHtmlElement('#eText');

        this.displayName = this.columnGroup.getColGroupDef() ? this.columnGroup.getColGroupDef().headerName : null;
        if (Utils.missing(this.displayName)) {
            this.displayName = '>>'
        }

        eText.innerHTML = this.displayName;
        this.setupExpandContract();

        var eIndent = this.queryForHtmlElement('#eIndent');
        eIndent.style.width = (this.columnDept * 10) + 'px';

        this.addDestroyableEventListener(eText, 'click', ()=> this.cbSelect.setSelected(!this.cbSelect.isSelected()) );

        this.addDestroyableEventListener(this.eventService, Events.EVENT_COLUMN_PIVOT_MODE_CHANGED, this.onColumnStateChanged.bind(this) );

        this.addDestroyableEventListener(this.cbSelect, AgCheckbox.EVENT_CHANGED, this.onCheckboxChanged.bind(this));

        this.setOpenClosedIcons();

        if (this.allowDragging) {
            this.addDragSource();
        }

        this.onColumnStateChanged();
        this.addVisibilityListenersToAllChildren();
    }

    private addVisibilityListenersToAllChildren(): void {
        this.columnGroup.getLeafColumns().forEach( column => {
            this.addDestroyableEventListener(column, Column.EVENT_VISIBLE_CHANGED, this.onColumnStateChanged.bind(this));
            this.addDestroyableEventListener(column, Column.EVENT_VALUE_CHANGED, this.onColumnStateChanged.bind(this) );
            this.addDestroyableEventListener(column, Column.EVENT_PIVOT_CHANGED, this.onColumnStateChanged.bind(this) );
            this.addDestroyableEventListener(column, Column.EVENT_ROW_GROUP_CHANGED, this.onColumnStateChanged.bind(this) );
        });
    }

    private addDragSource(): void {
        var dragSource: DragSource = {
            type: DragSourceType.ToolPanel,
            eElement: this.getGui(),
            dragItemName: this.displayName,
            dragItem: this.columnGroup.getLeafColumns()
        };
        this.dragAndDropService.addDragSource(dragSource);
    }

    private setupExpandContract(): void {
        this.eGroupClosedIcon = this.queryForHtmlElement('#eGroupClosedIcon');
        this.eGroupOpenedIcon = this.queryForHtmlElement('#eGroupOpenedIcon');

        this.eGroupClosedIcon.appendChild(Utils.createIcon('columnSelectClosed', this.gridOptionsWrapper, null, svgFactory.createFolderClosed));
        this.eGroupOpenedIcon.appendChild(Utils.createIcon('columnSelectOpen', this.gridOptionsWrapper, null, svgFactory.createFolderOpen));

        this.addDestroyableEventListener(this.eGroupClosedIcon, 'click', this.onExpandOrContractClicked.bind(this));
        this.addDestroyableEventListener(this.eGroupOpenedIcon, 'click', this.onExpandOrContractClicked.bind(this));
    }

    private onCheckboxChanged(): void {
        if (this.processingColumnStateChange) { return; }

        var childColumns = this.columnGroup.getLeafColumns();
        var selected = this.cbSelect.isSelected();

        if (this.columnController.isPivotMode()) {
            if (selected) {
                this.actionCheckedReduce(childColumns);
            } else {
                this.actionUnCheckedReduce(childColumns)
            }
        } else {
            this.columnController.setColumnsVisible(childColumns, selected);
        }
    }

    private actionUnCheckedReduce(columns: Column[]): void {

        var columnsToUnPivot: Column[] = [];
        var columnsToUnValue: Column[] = [];
        var columnsToUnGroup: Column[] = [];

        columns.forEach( column => {
            if (column.isPivotActive()) {
                columnsToUnPivot.push(column);
            }
            if (column.isRowGroupActive()) {
                columnsToUnGroup.push(column);
            }
            if (column.isValueActive()) {
                columnsToUnValue.push(column);
            }
        });

        if (columnsToUnPivot.length>0) {
            this.columnController.removePivotColumns(columnsToUnPivot);
        }
        if (columnsToUnGroup.length>0) {
            this.columnController.removeRowGroupColumns(columnsToUnGroup);
        }
        if (columnsToUnValue.length>0) {
            this.columnController.removeValueColumns(columnsToUnValue);
        }
    }

    private actionCheckedReduce(columns: Column[]): void {

        var columnsToAggregate: Column[] = [];
        var columnsToGroup: Column[] = [];
        var columnsToPivot: Column[] = [];

        columns.forEach( column => {
            // don't change any column that's already got a function active
            if (column.isAnyFunctionActive()) { return; }

            if (column.isAllowValue()) {
                columnsToAggregate.push(column);
            } else if (column.isAllowRowGroup()) {
                columnsToGroup.push(column);
            } else if (column.isAllowRowGroup()) {
                columnsToPivot.push(column);
            }

        });

        if (columnsToAggregate.length>0) {
            this.columnController.addValueColumns(columnsToAggregate);
        }
        if (columnsToGroup.length>0) {
            this.columnController.addRowGroupColumns(columnsToGroup);
        }
        if (columnsToPivot.length>0) {
            this.columnController.addPivotColumns(columnsToPivot);
        }

    }

    private onColumnStateChanged(): void {
        var columnsReduced = this.columnController.isPivotMode();

        var visibleChildCount = 0;
        var hiddenChildCount = 0;

        this.columnGroup.getLeafColumns().forEach( (column: Column) => {
            if (this.isColumnVisible(column, columnsReduced)) {
                visibleChildCount++;
            } else {
                hiddenChildCount++;
            }
        });

        var selectedValue: boolean;
        if (visibleChildCount>0 && hiddenChildCount>0) {
            selectedValue = null;
        } else if (visibleChildCount > 0) {
            selectedValue = true;
        } else {
            selectedValue = false;
        }

        this.processingColumnStateChange = true;
        this.cbSelect.setSelected(selectedValue);
        this.processingColumnStateChange = false;
    }

    private isColumnVisible(column: Column, columnsReduced: boolean): boolean {
        if (columnsReduced) {
            var pivoted = column.isPivotActive();
            var grouped = column.isRowGroupActive();
            var aggregated = column.isValueActive();
            return pivoted || grouped || aggregated;
        } else {
            return column.isVisible();
        }
    }

    private onExpandOrContractClicked(): void {
        this.expanded = !this.expanded;
        this.setOpenClosedIcons();
        this.expandedCallback();
    }

    private setOpenClosedIcons(): void {
        var folderOpen = this.expanded;
        Utils.setVisible(this.eGroupClosedIcon, !folderOpen);
        Utils.setVisible(this.eGroupOpenedIcon, folderOpen);
    }

    public isExpanded(): boolean {
        return this.expanded;
    }
}