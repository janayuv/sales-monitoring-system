import { useState, useEffect } from "react";
import { TableDensity } from "../../Table/types";
import { TableStorage } from "../../Table/services/tableStorage";
import { DEFAULT_DENSITY } from "../../Table/constants";
import { CUSTOMER_COLUMNS } from "../metadata/customerColumns";

const TABLE_KEY = "customer-table";

export function useCustomerColumns() {
  const defaultVisibleCols = CUSTOMER_COLUMNS.filter((c) => c.defaultVisible !== false).map(
    (c) => c.id
  );

  const [visibleColumns, setVisibleColumns] = useState<string[]>(() =>
    TableStorage.get<string[]>(TABLE_KEY, "columns", defaultVisibleCols)
  );

  const [density, setDensity] = useState<TableDensity>(() =>
    TableStorage.get<TableDensity>(TABLE_KEY, "density", DEFAULT_DENSITY)
  );

  useEffect(() => {
    TableStorage.set(TABLE_KEY, "columns", visibleColumns);
  }, [visibleColumns]);

  useEffect(() => {
    TableStorage.set(TABLE_KEY, "density", density);
  }, [density]);

  return {
    visibleColumns,
    setVisibleColumns,
    density,
    setDensity,
  };
}
