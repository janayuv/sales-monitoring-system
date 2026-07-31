import { useState, useMemo, useEffect } from "react";

export function useRegisterPagination<T>(items: T[], defaultPageSize = 25) {
  const [pageSize, setPageSize] = useState<number>(defaultPageSize);
  const [currentPageIndex, setCurrentPageIndex] = useState<number>(0);

  // Reset to first page whenever dataset changes significantly
  useEffect(() => {
    setCurrentPageIndex(0);
  }, [items.length]);

  const totalPages = useMemo(() => {
    return Math.max(1, Math.ceil(items.length / pageSize));
  }, [items.length, pageSize]);

  const paginatedItems = useMemo(() => {
    const start = currentPageIndex * pageSize;
    return items.slice(start, start + pageSize);
  }, [items, currentPageIndex, pageSize]);

  const handlePrevPage = () => {
    setCurrentPageIndex((prev) => Math.max(0, prev - 1));
  };

  const handleNextPage = () => {
    setCurrentPageIndex((prev) => Math.min(totalPages - 1, prev + 1));
  };

  const handlePageSizeChange = (newSize: number) => {
    setPageSize(newSize);
    setCurrentPageIndex(0);
  };

  return {
    pageSize,
    currentPageIndex,
    totalPages,
    paginatedItems,
    handlePrevPage,
    handleNextPage,
    handlePageSizeChange,
    setCurrentPageIndex,
  };
}
