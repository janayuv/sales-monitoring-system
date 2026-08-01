import { useState, useEffect } from "react";
import { TableStorage } from "../../Table/services/tableStorage";
import { DEFAULT_PAGE_SIZE } from "../../Table/constants";

const TABLE_KEY = "customer-table";

export function useCustomerPagination() {
  const [pageSize, setPageSize] = useState<number>(() =>
    TableStorage.get<number>(TABLE_KEY, "pagesize", DEFAULT_PAGE_SIZE)
  );

  const [pageIndex, setPageIndex] = useState<number>(1);

  useEffect(() => {
    TableStorage.set(TABLE_KEY, "pagesize", pageSize);
  }, [pageSize]);

  return {
    pageSize,
    setPageSize,
    pageIndex,
    setPageIndex,
  };
}
